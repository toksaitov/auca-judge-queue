auca-judge-queue
================

*auca-judge-queue* is a task queue service for the *auca-judge* system.

*auca-judge-queue* periodically checks a task queue database for new tasks,
fetches one if avialiable, gets associated submission data from a separate
task database, and sends the submission to the [auca-judge-back](https://github.com/toksaitov/auca-judge-agent)
service to process. It can also subscribe to the task queue database to wake up
and start its work on an event of a new task being published.

## Prerequisites

* *Node.js*, *npm* `>=4.4.3`, `>=2.15.2`
* *etcd* `>= 2.3.0`
* *Redis* `>= 3.0.7`
* *MongoDB* `>= 3.2.5`

## Configuration

*auca-judge-queue* tries to load a configuration files in the JSON format in the
current working directory under the name *auca-judge-queue-configuration.json*

### Configuration Format

```json
{
  "option": "value",
  "option": ["value", "value"],
  "option": 42
}
```

### Configuration Options

* `"periodic": boolean`

  a flag to enable periodic checks of the task queue (set to true by default)

* `"periodicDelay": number`

  time in milliseconds between task queue checks (set to 1000 by default)

* `"heartbeatDelay": number`

  time in milliseconds to send service discovery information to etcd (set to
  5000 by default)

* `"backServer": string`

  URL to a working instance of the *auca-judge-back* service that will be used
  to send submissions to (set to "0.0.0.0:7070" by default)

* `"databases": object`

  database connection options to the `service` database for service discovery
  and health checks, `queue` database for the task queue service, and `task`
  database to fetch submission data.

  Connection options passed mostly as it is to the database driver. Refer to
  documentation of the current drivers for all available options.

  * service: etcd, [node-etcd](https://github.com/stianeikeland/node-etcd)
  * queue: Redis, [ioredis](https://github.com/luin/ioredis)
  * task: MongoDB, [mongoose](https://github.com/Automattic/mongoose)

  Database connection options can be overriden with a JSON entry in the
  following environment variables

  * *AUCA_JUDGE_QUEUE_SERVICE_DATABASE*
  * *AUCA_JUDGE_QUEUE_QUEUE_DATABASE*
  * *AUCA_JUDGE_QUEUE_TASK_DATABASE*

  By default database connection options will be set to point to *localhost*
  with default etcd, Redis, and MongoDB ports.

### Sample Configuration Files

```json
{
  "periodic": true,
  "periodicDelay": 1000,
  "heartbeatDelay": 5000,
  "backServer": "http://0.0.0.0:7070",
  "databases": {
    "service": {
      "hosts": ["0.0.0.0:2379"]
    },
    "queue": {
      "host": "0.0.0.0",
      "port": "6379"
    },
    "task": {
      "url": "mongodb://0.0.0.0:27017/auca_judge"
    }
  }
}
```

## Usage

* `npm install`: to install dependencies

* `npm start`: to start the server

## Licensing

*auca-judge-queue* is licensed under the MIT license. See LICENSE for the full
license text.

## Credits

*auca-judge-queue* was created by [Dmitrii Toksaitov](https://github.com/toksaitov).
