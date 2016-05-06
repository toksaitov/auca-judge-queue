"use strict";

const fs =
  require("fs");
const path =
  require("path");
const util =
  require("util");

const Etcd =
  require('node-etcd');
const redis =
  require("redis");
const mongoose =
  require("mongoose");
const uuid =
  require("node-uuid");
const request =
  require("request");
const logger =
  require("winston");

function Queue() {
  this.id =
    uuid.v4();

  this.backServer =
    null;

  this.databases = {
    "service": {
      "connection": null,
      "connectiondata": null
    },
    "queue": {
      "connection": null,
      "connectiondata": null
    },
    "task": {
      "connection": null,
      "connectiondata": null
    }
  };

  this.busy =
    false;

  this.taskListID =
    `queue:${this.id}`;

  let configurationFiles = [
    "./auca-judge-queue-configuration.json"
  ];
  this.configuration =
    this._loadConfiguration(configurationFiles);

  this._registerModels();
}

Queue.prototype = {
  constructor: Queue,

  start: function() {
    logger.info(`Queue '${this.id}': starting at ${new Date().toString()}`);

    let configuration =
      this.configuration;
    let databases =
      this.databases;

    let serviceDatabaseConnectionData =
      databases["service"]["connectionData"];
    let serviceDatabase =
      null;
/*
      databases["service"]["connection"] =
        this._connectToEtcd(
          "serviceDatabase",
          serviceDatabaseConnectionData
        );
*/

    if (!serviceDatabase) {
      this._setupDatabases();

      return;
    }

    let heartbeatDelay =
      configuration["heartbeatDelay"];

    serviceDatabase.get("services/queueDatabase", (error, value) => {
      if (error) {
        logger.error(
          "Failed to get information about 'queueDatabase' from the " +
          "'serviceDatabase'",
          serviceDatabaseConnectionData
        );
        logger.error(error);
      }

      databases["queue"]["connectionData"] =
        value || databases["queue"]["connectionData"];

      serviceDatabase.get("services/taskDatabase", (error, value) => {
        if (error) {
          logger.error(
            "Failed to get information about 'taskDatabase' from the " +
            "'serviceDatabase'",
            serviceDatabaseConnectionData
          );
          logger.error(error);
        }

        databases["task"]["connectionData"] =
          value || databases["task"]["connectionData"];

        this._setupDatabases();
      });
    });

    setInterval(() => {
      let options = {
        "ttl": heartbeatDelay
      };

      serviceDatabase.set("heartbeat", "serviceDatabase", options, error => {
        if (error) {
          logger.error(
            "Failed to send heartbeat information to the 'serviceDatabase'",
            serviceDatabaseConnectionData
          );
          logger.error(error);
        }
      });
    }, heartbeatDelay);
  },

  _loadConfiguration: function(configurationFiles) {
    logger.info(
      `Queue '${this.id}': loading configuration from '${configurationFiles}'`
    );

    let mergedConfiguration =
      { };

    configurationFiles.forEach(configurationFile => {
      let configurationFileContent =
        null;

      try {
        configurationFileContent =
          fs.readFileSync(path.resolve(configurationFile), "utf-8");
      } catch (error) {
        logger.warning(
          `Failed to read the configuration file '${configurationFile}'`
        );
        logger.warning(error);
      }

      let configuration =
        { };

      if (configurationFileContent) {
        try {
          configuration =
            JSON.parse(configurationFileContent);
        } catch (error) {
          logger.error(
            `Failed to parse the configuration file '${configurationFile}'`,
            configurationFileContent
          );
          logger.error(error);
        }

        for (let property in configuration) {
          if (configuration.hasOwnProperty(property)) {
            mergedConfiguration[property] =
              configuration[property];
          }
        }
      }
    });

    return this._resolveConfiguration(mergedConfiguration);
  },

  _resolveConfiguration: function(configuration) {
    logger.info(`Queue '${this.id}': resolving configuration`);

    configuration["periodic"] =
      !!configuration["periodic"];
    configuration["periodicDelay"] =
      configuration["periodicDelay"] || 1000;
    configuration["heartbeatDelay"] =
      configuration["heartbeatDelay"] || 5000;

    configuration["backServer"] =
      configuration["backServer"] || "http://0.0.0.0:7070";

    let databaseConfigurations =
      configuration["databases"] =
        configuration["databases"] || { };

    databaseConfigurations["service"] =
      this._extractEnvironmentConfiguration("AUCA_JUDGE_QUEUE_SERVICE_DATABASE") ||
        databaseConfigurations["service"] || {
          "hosts": ["0.0.0.0:2379"]
        };
    databaseConfigurations["queue"] =
      this._extractEnvironmentConfiguration("AUCA_JUDGE_QUEUE_QUEUE_DATABASE") ||
        databaseConfigurations["queue"] || {
          "host": "0.0.0.0",
          "port": "6379"
        };
    databaseConfigurations["task"] =
      this._extractEnvironmentConfiguration("AUCA_JUDGE_QUEUE_TASK_DATABASE") ||
        databaseConfigurations["task"] || {
          "url": "mongodb://0.0.0.0/auca_judge"
        };

    let databases =
      this.databases;

    databases["service"]["connectionData"] =
      databaseConfigurations["service"];
    databases["queue"]["connectionData"] =
      databaseConfigurations["queue"];
    databases["task"]["connectionData"] =
      databaseConfigurations["task"];

    return configuration;
  },

  _extractEnvironmentConfiguration: function(serviceKey) {
    logger.info(
      `Queue '${this.id}': extracting environment configuration for service ` +
      `key '${serviceKey}'`
    );

    let environmentConfiguration =
      null;

    let environmentValue = process.env[serviceKey];
    if (environmentValue) {
      try {
        environmentConfiguration =
          JSON.parse(environmentValue);
      } catch(error) {
        logger.error(
          `Failed to parse environment configuration '${environmentValue}' ` +
          `under the key '${serviceKey}'`,
          process.env
        );
        logger.error(error);
      }
    }

    return environmentConfiguration;
  },

  _registerModels: function() {
    logger.info(`Queue '${this.id}': registering models`);

    let taskSchema =
      require("./models/task.js");

    mongoose.model("Task", taskSchema);
  },

  _connectToEtcd: function(name, connectionData) {
    logger.info(
      `Queue '${this.id}': connecting to the etcd service '${name}'`,
      connectionData
    );

    let database =
      new Etcd(connectionData);

    return database;
  },

  _connectToRedisDatabase: function(name, connectionData) {
    logger.info(
      `Queue '${this.id}': connecting to the Redis service '${name}'`,
      connectionData
    );

    let database =
      redis.createClient(
        connectionData
      );

    database.on("ready", () => {
      logger.info(`Queue '${this.id}': connected to the '${name}'`);
    });
    database.on("reconnecting", () => {
      logger.info(`Queue '${this.id}': reconnecting to the '${name}'`);
    });
    database.on("end", () => {
      logger.info(`Queue '${this.id}': disconnected from the '${name}'`);
    });
    database.on("error", error => {
      logger.error(`An error has occured while working with the '${name}'`);
      logger.error(error);
    });

    return database;
  },

  _connectToMongoDatabase: function(name, connectionData) {
    logger.info(
      `Queue '${this.id}': connecting to a Mongo service '${name}'`,
      connectionData
    );

    let url =
      connectionData["url"];

    let database =
      mongoose.createConnection(
        url, connectionData
      );

    database.on("open", () => {
      logger.info(`Queue '${this.id}': connected to the '${name}'`);
    });
    database.on("reconnected", () => {
      logger.info(`Queue '${this.id}': reconnected to the '${name}'`);
    });
    database.on("close", () => {
      logger.info(`Queue '${this.id}': disconnected from the '${name}'`);
    });
    database.on("error", error => {
      logger.error(`An error has occured while working with the '${name}'`);
      logger.error(error);
    });

    return database;
  },

  _setupDatabases: function() {
    logger.info(`Queue '${this.id}': setting up key database connections`);

    let databases =
      this.databases;
    let queueDatabaseConnectionData =
      databases["queue"]["connectionData"];
    let taskDatabaseConnectionData =
      databases["task"]["connectionData"];

    databases["queue"]["connection"] =
      this._connectToRedisDatabase(
        "queueDatabase",
        queueDatabaseConnectionData
      );
    databases["task"]["connection"] =
      this._connectToMongoDatabase(
        "taskDatabase",
        taskDatabaseConnectionData
      );

    this._setupEventHandling();
    this._setupPeriodicTaskQueueChecks();
  },

  _setupEventHandling: function() {
    logger.info(`Queue '${this.id}': setting up event handlers`);

    let databases =
      this.databases;

    let queueDatabaseConnectionData =
      databases["queue"]["connectionData"];
    let queueDatabase =
      this._connectToRedisDatabase(
        "queueDatabaseEvents",
        queueDatabaseConnectionData
      );

    let channel =
      "queue:taskQueued";

    queueDatabase.subscribe(channel, error => {
      if (error) {
        logger.error(
          `Failed to subscribe to the channel '${channel}' in the ` +
          "'queueDatabase'",
          queueDatabaseConnectionData
        );
        logger.error(error);
      }
    });

    queueDatabase.on("message", () => {
      this._checkTaskQueue();
    });
  },

  _setupPeriodicTaskQueueChecks: function() {
    logger.info(`Queue '${this.id}': setting up periodic task queue checks`);

    let configuration =
      this.configuration;

    let periodicTaskQueueCheckEnabled =
      configuration["periodic"];
    let periodicTaskQueueCheckDelay =
      configuration["periodicDelay"];

    if (periodicTaskQueueCheckEnabled) {
      setInterval(() => {
        this._checkTaskQueue();
      }, periodicTaskQueueCheckDelay);
    }
  },

  _checkTaskQueue: function() {
    logger.info(
      `Queue '${this.id}': checking task queue at ${new Date().toString()}`
    );

    let databases =
      this.databases;

    let queueDatabase =
      databases["queue"]["connection"];
    let queueDatabaseConnectionData =
      databases["queue"]["connectionData"];

    let taskListID =
      this.taskListID;

    if (!this.busy) {
      this.busy =
        true;

      queueDatabase.rpoplpush("queue:tasks", taskListID, (error, taskID) => {
        if (error) {
          logger.error(
            `Failed to get a task ID from the task queue '${taskListID}' ` +
            "in the 'queueDatabase'",
            queueDatabaseConnectionData
          );
          logger.error(error);

          this.busy =
            false;

          return;
        }

        if (taskID) {
          this._processTaskID(taskID);
        } else {
          this.busy =
            false;
        }
      });
    }
  },

  _processTaskID: function(taskID) {
    logger.info(
      `Queue '${this.id}': attempting to get task data for the ID '${taskID}'`
    );

    let databases =
      this.databases;

    let taskDatabase =
      databases["task"]["connection"];
    let taskDatabaseConnectionData =
      databases["task"]["connectionData"];

    let Task =
      taskDatabase.model("Task");

    Task.findById(taskID, (error, task) => {
      if (error) {
        logger.error(
          `Failed to get a task document for task ID '${taskID}' from the ` +
          "'taskDatabase'",
          taskDatabaseConnectionData
        );
        logger.error(error);

        if (!task) {
          task = {
            "id": taskID
          };
        }

        this._finishProcessingTask(task);
      } else {
        this._processTask(task);
      }
    });
  },

  _finishProcessingTask: function(task) {
    logger.info(
      `Queue '${this.id}': finishing processing the task '${task.id}'`
    );

    this.busy =
      false;

    if (task) {
      this._removeFromTaskList(task);
    }
  },

  _removeFromTaskList: function(task) {
    logger.info(
      `Queue '${this.id}': removing the task '${task.id}' from the ` +
      "service task list"
    );

    let databases =
      this.databases;

    let queueDatabase =
      databases["queue"]["connection"];
    let queueDatabaseConnectionData =
      databases["queue"]["connectionData"];

    let taskID =
      task.id;
    let taskListID =
      this.taskListID;

    queueDatabase.lrem(taskListID, 0, taskID, error => {
      if (error) {
        logger.error(
          `Failed to clean up the service list '${taskListID}' in the ` +
          `'queueDatabase' from the task ID '${taskID}'`,
          queueDatabaseConnectionData
        );
        logger.error(error);
      }
    });
  },

  _backoffProcessingTask: function(task) {
    logger.info(
      `Queue '${this.id}': stopping processing the task '${task.id}' and ` +
      "putting it back to the queue"
    );

    this.busy =
      false;

    if (task) {
      this._putBackFromTaskListToQueue(task);
    }
  },

  _putBackFromTaskListToQueue: function(task) {
    logger.info(
      `Queue '${this.id}': removing the task '${task.id}' from the ` +
      "service task list and putting it back to the queue"
    );

    let databases =
      this.databases;

    let queueDatabase =
      databases["queue"]["connection"];
    let queueDatabaseConnectionData =
      databases["queue"]["connectionData"];

    let taskID =
      task.id;
    let taskListID =
      this.taskListID;

    queueDatabase.lpop(taskListID, (error, result) => {
      if (error) {
        logger.error(
          `Failed to remove the task with ID '${taskID}' from the service ` +
          `list '${taskListID}' in the 'queueDatabase'`,
          queueDatabaseConnectionData
        );
        logger.error(error);

        this._removeFromTaskList(task);

        return;
      }

      queueDatabase.rpush("queue:tasks", result, (error, reply) => {
        if (error) {
          logger.error(
            `Failed to put back the task with ID '${taskID}' to the task ` +
            `queue from the service list '${taskListID}' in the 'queueDatabase'`,
            queueDatabaseConnectionData
          );
          logger.error(error);
        }
      });
    });
  },

  _processTask: function(task) {
    logger.info(
      `Queue '${this.id}': processing the task '${task.id}'`
    );

    let configuration =
      this.configuration;
    let backServerURL =
      configuration["backServer"];

    let problemID =
      "";
    let submissionID =
      "";
    let submission =
      "";

    try {
      problemID =
        task.problem_id.toString();
      submissionID =
        task.id;
      submission =
        task.submission;
    } catch (error) {
      logger.error(
        "Failed to extract submission information from the task object"
      );
      logger.error(util.inspect(task, { "depth": 2 }));
      logger.error(error);

      this._finishProcessingTask(task);

      return;
    }

    let form = {
      "form": {
        "id": problemID,
        "submission_id": submissionID,
        "submission": submission
      }
    };

    function accessBackServer(backServerURL, form, attempts) {
      request.post(backServerURL, form, (error, response, body) => {
        if (error || !response || response.statusCode !== 302) {
          let responseStatus =
            response ? response.statusCode : "-";

          logger.error(
            "Failed to communicate with the back end server at " +
            `'${backServerURL}'. The response status and reply ` +
            `body were '${responseStatus}'\n${body}`
          );
          logger.error(error);

          if (response) {
            if (responseStatus === 400) {
              this._finishProcessingTask(task);

              return;
            } else if (responseStatus === 429 || responseStatus === 500) {
              this._backoffProcessingTask(task);

              return;
            }
          }

          if (attempts > 0) {
            setTimeout(() => {
              accessBackServer.bind(this, backServerURL, form, attempts - 1)();
            }, 500);
          } else {
            this._backoffProcessingTask(task);
          }

          return;
        }

        this._finishProcessingTask(task);
      });
    }

    let attempts = 3;
    accessBackServer.bind(this, backServerURL, form, attempts)();
  }
};

module.exports =
  Queue;
