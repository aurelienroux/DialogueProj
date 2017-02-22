'use strict';
require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const InitClient = require('initai-node');
const axios = require('axios');
const morgan = require('morgan');

const projectLogicScript = require('./behavior/scripts/');
/**
*WILD WILD RENEGADE FUNCTIONS
**/
function isNotEvent(el){
  if(el.sender_role === "end-user" || el.sender_role === "app"){
    return true;
  }
  return false
}

/**
* Send the result of the logic invoation to Init.ai
**/
function sendLogicResult(invocationPayload, result) {
  const invocationData = invocationPayload.invocation_data;
  const requestConfig = {
    method: 'POST',
    baseURL: invocationData.api.base_url,
    url: `/api/v1/remote/logic/invocations/${invocationData.invocation_id}/result`,
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${invocationData.auth_token}`,
      'content-type': 'application/json',
    },
    data: {
      invocation: {
        invocation_id: invocationData.invocation_id,
        app_id: invocationPayload.current_application.id,
        app_user_id: Object.keys(invocationPayload.users)[0],
      },
      result: result,
    }
  };

  axios.request(requestConfig)
  .then(result => {
    console.log('Logic result sent\n\n%s', result.data);
  })
  .catch(err => {
    console.log('Logic result error\n\n%s', err.stack);
  });
}
/**
* all the outbound events
**/
//sends message to user with this function
function eventWebhook(initUserId,eventType,dataPayload) {
  const requestConfig = {
    method: 'POST',
    url: `https://api.init.ai/api/v1/webhook/event`,
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${process.env.JWT_TOKEN}`,
      'content-type': 'application/json',
    },
    data:{
      app_user_id: initUserId,
      event_type: eventType,
      data: dataPayload
    }
  }

  axios.request(requestConfig)
  .then(result => {
    console.log('Webhook caught a webfish and its looking good');
  })
  .catch(err => {
    console.log('the fish never got caught, the hook must be no good');
  });
}
//if there is an id passed it will switch to get conv by id mode
function getConv(convId) {
  let convURL;
  if(convId){
    convURL = `https://api.init.ai/api/v1/config/${process.env.PROJECT_ID}/logs/conversations/${convId}`;
  }else{
    convURL = `https://api.init.ai/api/v1/config/${process.env.PROJECT_ID}/logs/conversations`;
  }
  const requestConfig = {
    method: 'POST',
    url: convURL,
    headers: {
      'authorization': `Bearer ${process.env.CONV_JWT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    data:{
      query: {
       page_size: 100
      }
    }
  };
  return axios.request(requestConfig)
}
/**
* all the outbound events
**/
const cors = require('cors')
const app = express();

const server = require('http').createServer(app);

const io = require('socket.io')(server);

io.on('connection', function(socket) {
  socket.on('nurse_message', function(data) {
    console.log("RECEIVED NURSE MESSAGE", data)
  });
  socket.on('form_send', function(){
    eventWebhook("0046b452-036f-4dd6-5f24-a39bc77436f9","incoming:QForm",{
    	needsHuman: false,
      quetions:[
        {
          ask: 'do_you_smoke',
          accept: ['affirmative', 'decline', 'do_you_smoke_answer']
        },
        {
          ask: 'any_medications',
          accept: ['affirmative', 'decline','medication_answer']
        }
      ]
    })
  })
  //.... add any other events
});

app.use(cors())
app.use(bodyParser.json());
app.use(morgan('dev')); // @TODO change for prod

/**
 * Add a POST request handler for webhook invocations
 */
app.get('/', (req, res) => {
 res.sendStatus(200);
});

app.post('/', (req, res, next) => {
  const eventType = req.body.event_type;
  const eventData = req.body.data;
  const userMessage = eventData.payload.current_conversation.messages[0].parts[0].content;
  // Both LogicInvocation and MessageOutbound events will be sent to this handler
  if (eventType === 'LogicInvocation') {
    // io.emit('new_patient_message', {custom: 'data'})
    const initNodeClient = InitClient.create(eventData, {
      succeed(result) {
        console.log(JSON.stringify(result,null,4));
        console.log('SENDING USERMESSAGE', userMessage)
        io.emit('send_userMessage', userMessage)
        console.log(eventData);
        io.emit('state_change', {
          newState: result.payload.conversation_state,
          convId: '....'
        })
        sendLogicResult(eventData.payload, result)
      }
    });
    // An instance of the client needs to be provided to the `handle` method
    // exported from behavior/scripts/index.js to emulate the Lambda pattern
    projectLogicScript.handle(initNodeClient);
  }
  // Immediately return a 200 to acknowledge receipt of the Webhook
  res.sendStatus(200);
})

app.get('/socketTest', (req, res) => {
  res.sendFile(__dirname + '/index.html');
})
/**
 * Add a "heartbeat" endpoint to ensure server is up
 */
app.get('/heartbeat', (req, res) => {
  res.send('*heartbeat sound* Boom Boom...Boom Boom... *heartbeat sound*')
});
//if there is an id passed it will switch to get conv by id mode
app.get('/conv', (req, res) => {
  const convList =
  getConv()
  .then( conv => {
    const convList = conv.data.body.conversations.map(el => {
      return {
        convId: el.id,
        userId: el.users[0].id
      }
    })
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(convList));
  })
  .catch(err =>{
    console.log("there was an error while getting conversations", err, err.stack)
    res.sendStatus(404)
  });
});

app.get('/conv/:id', (req, res) => {
  getConv(req.params.id)
  .then(conv =>{
    return conv.data.body.conversation.messages.filter(isNotEvent)
  })
  .then(conv => {
    const msgList = conv.map(el => {
      return {
        id: el.id,
        sender: el.sender,
        createdAt: el.created_at,
        messageContent: el.parts[0].content
      }
    })
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(msgList));
  })
  .catch(err =>{
    console.log("there was an error while getting conversations", err, err.stack)
    res.sendStatus(404)
  });
})

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {

  if (process.env.NODE_ENV === 'development') { //added s because i dont like this tunnel things ITS BROKENEDETED
    console.log(`http://localhost:${PORT}/`);
    const localtunnel = require('localtunnel');

    const tunnel = localtunnel(PORT, {subdomain: 'raid55'}, (err, tunnel) => {
      if (err) {
        console.log('Localtunnel failure', err);
      }
      else {
        console.log('Localtunnel listening at %s', tunnel.url);
      }
    });

    tunnel.on('error', err => console.log('Localtunnel error\n\n%s', err));
    tunnel.on('close', () => console.log('Localtunnel closed'));
  }
});
//
//
//
//
//
//
//
//

//
// function makeIntoNiceConversation(conversationPart) {
//   return {
//     messageId: conversationPart.blabla
//   }
// }
//
