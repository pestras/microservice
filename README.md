# Pestras Microservice

**Pestras Microservice** as **PMS** is built on nodejs framework using typescript, supporting http rest service, nats server, socket io and can run multible instances based on
nodejs cluster with messageing made easy between workers.

## Creating Service

In order to create our service we need to use **SERVICE** decorator which holds the main configuration of our service class.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ version: 1 })
class Test {}
```

### Service Configurations

Name        | Type     | Defualt         | Description
----        | -----    | ------          | -----
version     | number   | 0               | Current verion of our service, versions are used on rest resource */someservice/v1/...*.
port        | number   | 3000            | Http server listening port.   
host        | string   | 0.0.0.0         | Http server host.
workers     | number   | 0               | Number of node workers to run, if assigned to minus value will take max number of workers depending on os max cpus number
logLevel    | LOGLEVEL | LOGLEVEL.INFO   |
tranferLog  | boolean  | false           | Allow logger to transfer logs to the service **log** method
nats        | string \| number \| NatsConnectionOptions | null        | see [Nats Docs](https://docs.nats.io/)
exitOnUnhandledException | boolean | true |
socket | SocketIOOptions | null |
authTimeout | number | 15000 | auth method timeout

#### LOGLEVEL Enum

**PMS** provides only four levels of logs grouped in an enum type **LOGLEVEL**

- LOGLEVEL.ERROR
- LOGLEVEL.WARN
- LOGLEVEL.INFO
- LOGLEVEL.DEBUG

### SocketIOOptions

Name | Type | default | Description
--- | --- | --- | ---
serverOptions | SocketIO.ServerOptions | null | see [socket.io docs](https://socket.io/docs/server-api/)
maxListeners  | number  | 10 |

## Micro

Before delving into service routes, subjects.. etc, let's find out how to run our service..

After defining our service class we use the **Micro** object to run our service through the *start* method.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({
  // service config
})
export class TEST {}

Micro.start(Test);
```

**Micro** object has another properties and methods that indeed we are going to use as well later in the service.

Name | Type | Description
--- | --- | ---
logger | Logger |
nats | NatsClient | see [Nats Docs](https://docs.nats.io/)
subscription | Map<string, NatsSubscription> | Holds all subsciptions defined in our service
namespaces | Map<string, SocketIO.Namespace> | Holds all namesspaces defind in our service
message | (msg: string, data: WorkerMessage, target: 'all' \| 'others') => void | A helper method to broadcast a message between workers
publish | (msg: SocketIOPublishMessage) => void | A helper method to organize communication between socketio servers among workers
request | (options: IFetchOptions) => Promise<{ statusCode: number, data: any }> | For http requests
attempt | (action: (curr: number) => Promise, options: AttemptOptions) | Multiple calls for promise helper function

## ROUTE DECORATOR

Used to define a route for a rest service.

**ROUTE** accepts an optional config object to configure our route.

Name | type | Default | Description
--- | --- | --- | --- 
name | string | Method name applied to | name of the route
path | string | '' | Service path pattern
method | HttpMethod | 'GET' | 
requestType | string | 'application/json | Same as 'Content-Type' header
validate | (req: Request, res: Response) => boolean \| Promise\<boolean\> | null | validation method
bodyQuota | number | 1024 * 100 | Request body size limit
queryLength | number | 100 | Request query characters length limit
auth | (request: Request, res: Response) => boolean \| Promise\<boolean\> | null | auth method
timeout | number | 15000 | Max time to handle the request before canceling

```ts
import { SERVICE, ROUTE } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3333
})
class Articles {

  @ROUTE({
    // /articles/v1/{id}
    path: '/{id}'
  })
  getArticle(req: Request, res: Response) {
    let id = req.params.id;

    // get artcle code

    res.json(article);
  }

  @ROUTE({
    method: 'POST',
    // context is the service instance
    auth: async function (this: Article, req: Request<T>, res: Response) {
      //  some authorization
      // return false to end request
    }
  })
  insertArticle(req: Request<T>, res: Response) {
    let auth = req.auth;
    let article = req.body;

    // insert article

    res.json({ id: artcle.id });
  }
}
```

*Note: Both validation and auth methods should handle the response on failure and returning or resolving to false, also the context is changed to the service instance
but we need to inform typescript by defining the type of 'this' to the service class name.*

### Request

**PMS** http request holds the original Node IncomingMessage with a few extra properties.

Name | Type | Description
--- | --- | ---
url | URL | URL extends Node URL class with some few properties, most used one is *query*.
params | { [key: string]: string } | includes route path params values.
body | any |
auth | any | useful to save some auth value.
get | (key: string) => string | method to get specific request header value
locals | Object | to set any additional data 
http | NodeJS.IncomingMessage | 

### Response

**PMS** http response holds the original Node Server Response with a couple of methods.

Name | Type | Description
--- | --- | ---
json | (data?: any) => void | Used to send json data.
status | (code: number) => Response | Used to set response status code.
end | any | Overwrites orignal end method *recommended to use*
http | NodeJS.ServerResponse | 

**Response** will log any 500 family errors automatically.

### Request Path Patterns

**PM** path patterns are very useful that helps match specific cases

1. **/articles/{id}** - *id* is a param name that match any value: */articles/4384545*, */articles/45geeFEe8 but not */articles* or /articles/dsfge03tG9/1

2. **/articles/{id}?** - same the previous one but id params is optional, so */articles* is acceptable.

3. **/articles/{cat}/{start}?/{limit}?** - cat params is required, however start and limit are optionals,
*/articles/scifi*, */articles/scifi/0*, */articles/scifi/0/10* all matched

4. **/articles/{id:^[0-9]{10}$}** - id param is constrained with a regex that allow only number value with 10 digits length only.

5. **/articles/*** - this route has rest operator which holds the value of the rest of the path,
*articles/scifi/0/10 does match and **request.params['\*']** equals 'scifi/0/10', however */articles* does not match

6. **/articles/*?** - same as the previous however */articles* does match

#### notes:

- Rest operator accepts preceding parameter but not optional parameters.
- Adding flags to regexp would be */articles/{id:^\w{10}$**:i**}*.
- Parameters with Regexp can be optional as will */articles/{id:^\w{10}$**:i**}?*
- Parameters can be seperated by fixed value blocks */articles/{aid}/comments/{cid}*
- Parameters and rest operator can be seperated by fixed value blocks as well.


## SUBJECT DECORATOR

Used to subscribe to nats server pulished subjects, and also accepts a config object.

Name | Type | Required | Default | Description
--- | --- | --- | --- | ---
subject | string | true | - | Nats server subject pattern
validate | (nats: Nats.Client, msg: NatsMsg<T>) => boolean \| Promise\<boolean\> | null | validation method
dataQuota | number | false | 1024 * 100 | Subject msg data size limit
payload | Nats.Payload | false | Payload.JSON | see [Nats Docs](https://docs.nats.io/)
options | Nats.SubscriptionOptions | false | null | see [Nats Docs](https://docs.nats.io/)
auth | (nats: Nats.Client, msg: NatsMsg<T>) => boolean \| Promise\<boolean\> | false | null | auth method

```ts
import { SERVICE, SUBJECT } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3334,
  workers: 4
})
class Email {

  @SUBJECT({
    subject: 'user.insert',
    auth: async function (this: Email, nats: Nats.Client, msg: Nats.Msg) {
      //  some authorization
    },
    options: { queue: 'emailServiceWorker' }
  })
  sendActivationEmail(nats: Nats.Client, msg: Nats.Msg) {
    let auth = msg.data.auth;
  }
```

*Note: Both validation and auth methods context is changed to the service instance
but we need to inform typescript by defining the type of 'this' to the service class name.*

# SocketIO

**PMS** provides us with several decoratoes to manage our SocketIO server.

## CONNECT DECORATOR

This decorator will call the method attached to whenever a new socket has connected,
it accepts an optional array of namespaces names, defaults to ['default'] which is the main **io** server instance.

```ts
import { SERVICE, CONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @CONNECT()
  onSocketConnect(io: SocketIO.Servier, socket: SocketIO.Socket) {}

  @CONNECT(['blog'])
  onSocketConnectToBlog(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

## RECONNECT DECORATOR

Called whenever a socket reconnect to the namespace or the server.

```ts
import { SERVICE, RECONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @RECONNECT()
  onSocketReconnect(io: SocketIO.Servier, socket: SocketIO.Socket) {}

  @RECONNECT(['blog'])
  onSocketReconnectToBlog(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

## HANDSHAKE DECORATOE

Called when a socket establish a coonection for the first time, mostly used for authorization.

It accepts an optional array of namespaces names and defaults to ['defualt'].

The second parameter is for auth helper.

```ts
import { SERVICE, HANDSHAKE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @HANDSHAKE()
  handshake(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @HANDSHAKE(['blog'])
  blogHandshake(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {
    
  }
}
```

## USE DECORATOE

Same as **HANDSHAKE** decorator, however no auth method expected.

```ts
import { SERVICE, USE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @USE()
  use(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @USE(['blog'])
  blogUse(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {}
}
```

## USESOCKET DECORATOE

Used to listen to all socket incoming events.

```ts
import { SERVICE, USESOCKET } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @USESOCKET()
  useSocket(io: SocketIO.Servier, packet: SocketIO.Packet, next: (err?: any) => void) {}

  @USESOCKET(['blog'])
  blogUseSocket(ns: SocketIO.Namespace, packet: SocketIO.Packet, next: (err?: any) => void) {}
}
```

## EVENT DECORATOE

Used to listen to a specific event, accepts an event name as a first parameter and an optional array of namespaces for the second defaults to ['default'].

```ts
import { SERVICE, EVENT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @EVENT('userLoggedIn')
  userLoggedIn(io: SocketIO.Servier, socket: SocketIO.Socket, ...args: any[]) {}

  @EVENT('newArticle', ['blog'])
  newArticle(ns: SocketIO.Namespace, socket: SocketIO.Socket, ...args: any[]) {}
}
```

## DISCONNECT DECORATOE

Triggered when a socket disconnect form the namespace or the server.

```ts
import { SERVICE, DISCONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @DISCONNECT()
  socketDisconnected(io: SocketIO.Servier, packet: SocketIO.Packet) {}

  @DISCONNECT(['blog'])
  blogSocketDisconnected(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

# Cluster

**PMS** uses node built in cluster api, and made it easy for us to manage workers communications.

First of all to enable custering we should set workers number in our service configurations to some value other than zero.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {}
```

To listen for a message form another process.

```ts
import { SERVICE, MSG } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  @MSG('some message')
  onSomeMessage(data: any) {}
}
```

To send a message to other processes we need to use *Micro.message* method, it accepts three parameters.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
message | string | true | - | Message name
data | any | false | null | Message payload
target | 'all' \| 'others' | false | 'others' | If we need the same worker to receive the message as well.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {
  
  // some where in your service
  Micro.message('some message', { key: 'value' });
}
```

**PMS** provide us another helper method to manage communications between workers for handling socket io broadcasting using *Micro.publish* method which accepts SocketIOPublishMessage object.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
event | string | true | - | Event name that needs to be published
data | any[] | true | - | event payload array distructed on multipe arguments
namespace | string | false | 'default' | If we need to publish through a specific namespace
room | string | false | null | If we need to publish to a specific room
socketId | string | false | null | In case we need to send to specific socket or exclude it from the receivers
broadcast | boolean | false | false | When socketId is provided and broadcast set to true socket will be excluded it from receivers

```ts
import { SERVICE, EVENT, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  @EVENT('ArticleUpdated', ['blog'])
  onArticleUpdate(ns: SocketIO.Namespace, socket: SocketIO.Socket, id: string) {
    socket.to('members').emit('ArticleUpdated', id);
    Micro.publish({
      event: 'ArticleUpdated',
      data: id,
      namespace: 'blog',
      room: 'members'
    });
  }
}
```

Also it is made easy to restart all workers or the current one.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  // some where in our service

  // restarting all workers
  Micro.message('restart all');

  // restarting the current worker
  Micro.message('restart');
}
```

When restarting all workers, it is going to be one by one process, **PMS** is going to wait for the new
worker to start listening and then will restart the next one.

# Attempt helper

When multiple attempts on failure to reach the database for example **attempt** method whould be the right thing to use

```ts
@SERVICE()
class Article {
  
  @ROUTE()
  async getArticles(req, res) {
    try {
      // find articles will be called 3 times, with 5 sec waiting on each failure
      let articles = await Micro.attampt(
        (curr: number) => articles.find({ ... }),
        { tries: 3, interval: 5000 }
      );
    } catch (e) {
      // after all attempts failed
    }
  }
}
```

**attempt** can have a canceler if we want to set timeout for each request

```ts
@SERVICE()
class Article {
  
  @ROUTE()
  async getArticles(req, res) {
    try {
      // find articles will be called 3 times, with 5 sec waiting on each failure or cancel on timeout
      let articles = await Micro.attampt(
        (curr: number) => articles.find({ ... }),
        (promise) => {
          // terminate promise some how
        },
        // setting timeout option
        { tries: 3, interval: 5000, timeout: 5000 }
      );
    } catch (e) {
      // after all attempts failed or canceled on timeout
    }
  }
}
```

# Lifecycle & Events Methods

**PMS** will try to call some service methods in specific time or action if they were already defined in our service.

## onInit

When defined, will be called once our service is instantiated but nothing else, this method is useful when
we need to connect to a databese or to make some async operations before start listening one events or http requests.

It can return a promise or nothing.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  async onInit() {
    // connect to a databese
    return;
  }
}
```

## onReady

This method is called once all our listeners are ready.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  onReay() {}
}
```

## onExit

Called once our service is stopped for any reason, and the exit signal is passed as an argument.

```ts
@SERVICE()
class Publisher {

  onExit(signal: NodeJS.Signals) {
    // disconnecting from the databese
  }
}
```

## OnLog

**PMS** has a built in lightweight logger that logs everything to the console.

In order to change that behavior we can define **onLog** hook method in our service and **PMS** will detect that method and will transfer all logs to it, besides enabling **transferLog**
options in service config.

```ts
import { SERVICE, SUBJECT, Micro } from '@pestras/microservice';

@SERVICE({
  version: 1
  transferLog: process.env.NODE_ENV === 'production'
})
class Test {

  @SUBJECT({ subject: 'newArticle' })
  newArticle() {
    try {

    } catch (e) {
      Micro.logger.error('some error', e);
    }
  }

  onLog(level: LOGLEVEL, msg: any, extra: any) {
    // what ever you want
  }
}
```

## onHealthcheck

An event triggered for docker swarm healthcheck.

```ts
@SERVICE()
class Publisher {

  // http: GET /healthcheck
  async onHealthcheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onReadycheck

An event triggered for kubernetes ready check.

```ts
@SERVICE()
class Publisher {

  // http: GET /readiness
  async onReadycheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onLivecheck

An event triggered for kubernetes live check.

```ts
@SERVICE()
class Publisher {

  // http: GET /liveness
  async onLivecheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onRequest

Called whenever a new http request is received, passing the Request and Response instances as arguments, it can return a promise or nothing;

```ts
@SERVICE()
class Publisher {

  async onRequest(req: Request, res: Response) { }
}
```

This event method is called before authorizing the request or even before checking if there is a matched route or not.

## on404

Called whenever http request has no route handler found.

```ts
@SERVICE()
class Publisher {

  on404(req: Request, res: Response) {

  }
}
```

When implemented response should be implemented as well

## onError

Called whenever an error accured when handling an http request, passing the Request and Response instances and the error as arguments.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onError(req: Request, res: Response, err: any) { }
}
```

## onUnhandledRejection

I think it is clear by only reading the name.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onUnhandledRejection(reason: any, p: Promise<any>) { }
}
```

## onUnhandledException

Also clear.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onUnhandledException(err: any) { }
}
```

# Health Check

For health check in Dockerfile and docker-compose

```Dockerfile
HEALTHCHECK --interval=30s CMD node ./node_modules/@pestras/microservice/hc.js 3000
```

```yml
healthcheck:
  test: ["CMD", "node", "./node_modules/@pestras/microservice/hc.js", "3000"]
  interval: 1m30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

Port defaults to 3000 it is optional.

Thank you