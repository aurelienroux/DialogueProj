'use strict';
require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const InitClient = require('initai-node');
const axios = require('axios');
const morgan = require('morgan');

const projectLogicScript = require('./behavior/scripts/index.js');
/**
*WILD WILD RENEGADE FUNCTIONS
**/
function isNotEvent(el){
  if(el.sender_role === "end-user" || el.sender_role === "app"){
    return true;
  }
  return false
}

//
////Axios calls
//

//sends logic to init ai
function sendLogicResult(invocationPayload, result) {
  const invocationData = invocationPayload.invocation_data;
  const requestConfigForLogic = {
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
  axios.request(requestConfigForLogic)
  .then(result => {
    console.log('Logic result sent\n\n%s', result.data);
  })
  .catch(err => {
    console.log('Logic result error\n\n%s', err.stack);
  });
}
//makes a call to init.ai webhook
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
//
////End of the axios calls
//
const cors = require('cors')
const app = express();
const server = require('http').createServer(app);

const io = require('socket.io')(server);
//
////ThIS is where the IO starts
//
io.on('connection', function(socket) {
  //this sends a message with info from the react web app...same for now its preset but scalable
  socket.on('send_human_message', function(data) {
    eventWebhook("0046b452-036f-4dd6-5f24-a39bc77436f9","incoming:human:message",{
      message: data.message
    })
  })
  //this sends the form... for now it only sends on to one specific id but its ready for an upgrade anytime
  socket.on('send_form', function(){
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
  socket.on('send_human_response', function(data){
    eventWebhook("0046b452-036f-4dd6-5f24-a39bc77436f9","incoming:human:response",{
      needsHuman: false,
      humanResponse: {
        text: data.response,
      	baseType: data.baseType
      }
    })
  })
  //.... add any other events
});
//
////END of IO and end of the sockets
//

//All of the middle of the ware
app.use(cors())
app.use(bodyParser.json());
app.use(morgan('dev'));
//end of the middle of the ware


//Route for main / route
app.route('/')
  .get((req, res) => {
    res.sendStatus(200);
  })
  .post((req, res, next) => {
    const eventType = req.body.event_type;
    const eventData = req.body.data;
    console.log('EVENT DATA RECEIVED:\n%s', JSON.stringify(req.body,null,4));

    if (!eventData) {
      res.sendStatus(200);
      return;
    }
    const userMessage = eventData.payload.current_conversation.messages[0].parts[0].content;
    const userId = eventData.payload.current_conversation.__private_temp_user_id; // deprecated
    const sender = eventData.payload.current_conversation.messages[0].sender_role;
    const createdAt = eventData.payload.invocation_data.initiated_at;
    // Logic invocation
    // console.log(req.body);
    if (eventType === 'LogicInvocation') {

      // TODO: check if this LogicInvocation is for a user message
      io.emit('transmit_message', {
        userId: userId,
        convId: 'lol',
        sender: sender,
        createdAt: createdAt,
        messageContent: userMessage
      })

      const initNodeClient = InitClient.create(eventData, {
        succeed(result) {
          // console.log(JSON.stringify(result,null,4));
          console.log('SENDING USERMESSAGE', userMessage)
          io.emit('transmit_state', {
            newState: result.payload.conversation_state,
            userId: userId,
            convId: 'lol'
          })
          sendLogicResult(eventData.payload, result)
        }
      })
      projectLogicScript.handle(initNodeClient);
    }
    else if(eventType === 'MessageOutbound'){
      io.emit('transmit_message', {
        userId: userId,
        convId: 'lol',
        sender: sender,
        createdAt: createdAt,
        messageContent: userMessage
      })
    }
    res.sendStatus(200);
  })

//boom boom, this is a heartbeat to check if the server is alive
app.get('/heartbeat', (req, res) => {
  res.send('OK')
});

//CONVERSATION API
// app.get('/conv', (req, res) => {
//   const convList =
//   getConv()
//   .then( conv => {
//     const convList = conv.data.body.conversations.map(el => {
//       return {
//         convId: el.id,
//         userId: el.users[0].id
//       }
//     })
//     res.setHeader('Content-Type', 'application/json');
//     res.send(JSON.stringify(convList));
//   })
//   .catch(err =>{
//     console.log("there was an error while getting conversations", err, err.stack)
//     res.sendStatus(404)
//   });
// });
//conv that takes an id and returns the messages for that id
// app.get('/conv/:id', (req, res) => {
//   getConv(req.params.id)
//   .then(conv =>{
//     return conv.data.body.conversation.messages.filter(isNotEvent)
//   })
//   .then(conv => {
//     const msgList = conv.map(el => {
//       return {
//         convId: el.id,
//         sender: el.sender,
//         createdAt: el.created_at,
//         messageContent: el.parts[0].content
//       }
//     })
//     res.setHeader('Content-Type', 'application/json');
//     res.send(JSON.stringify(msgList));
//   })
//   .catch(err =>{
//     console.log("there was an error while getting conversations", err, err.stack)
//     res.sendStatus(404)
//   });
// })
//end
//conversation API

//port handler thing part
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
});
