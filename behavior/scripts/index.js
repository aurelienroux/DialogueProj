'use strict';

const MIN_CONFIDENCE = 0.20;
// format of qs
// const testQ = [
//   {
//     ask: 'do_you_smoke',
//     accept: ['affirmative', 'decline', 'smoking_answer']
//   },
//   {
//     ask: 'any_medications',
//     accept: ['affirmative', 'decline', 'medication_answer']
//   }
// ];

exports.handle = (client) => {
  // Helpers
  function requireHuman() {
    client.updateConversationState({
      needsHuman: true
    });
    client.done();
  }

  function shouldWaitForNurse(state) {
    return (
      state.needsHuman
      || !state.questions
      || state.questions.every(q => !!q.answer)
    );
  }

  // Create steps
  const waitForNurse = client.createStep({
    satisfied() {
      console.log('should wait?');
      console.log ('should wait: ', shouldWaitForNurse(client.getConversationState()));
      return !shouldWaitForNurse(client.getConversationState());
    },
    prompt() {
      requireHuman();
    }
  });

  const askQuestions = client.createStep({
    satisfied() {
      console.log('ask questions')
      return client.getConversationState().questions.every(
        q => typeof q.answer !== 'undefined'
      );
    },

    prompt() {
      const questions = client.getConversationState().questions;
      const messagePart = client.getMessagePart();

      const currentQuestion = questions.find(q => q.isAsking);
      const humanRes = client.getConversationState().humanResponse;

      //check if human responded
      if (currentQuestion && humanRes != null) {
        const humanResBaseType = humanRes.baseType
        currentQuestion.isAsking = false;
        currentQuestion.answer = humanRes.text;
        client.updateConversationState({humanResponse: null})
        if (currentQuestion.accept && !currentQuestion.accept.includes(humanResBaseType)) {
          console.log('not accepted', humanResBaseType, currentQuestion.accept);
          requireHuman();
          return;
        }
      }
      //else do tha regular things...
      else if (currentQuestion) {
        const baseType = messagePart.classification.base_type.value;

        // If we were asking a question, and the answer's classification is unexpected, signal the nurse
        if (currentQuestion.accept && !currentQuestion.accept.includes(baseType)) {
          console.log('not accepted', baseType, currentQuestion.accept);
          requireHuman();
          return;
        }
        // If we get here, then we have a satisfactory answer, move on!
        currentQuestion.isAsking = false;
        currentQuestion.answer = messagePart.content;
      }
      // Setup the next question if there is one
      const nextQuestion = questions.find(q => !q.answer);

      if (nextQuestion) {
        nextQuestion.isAsking = true;
        client.addResponse(`ask_question/${nextQuestion.ask}`);
      }

      // Update the convo state with any answers / new questions
      client.updateConversationState({
        questions:  questions
      });

      client.done();
    }
  })

  const handleRenegadeEvent = function(eventType, payload) {
    //should be changed to console log
    client.addTextResponse('Received event of type: ' + eventType)
    client.done()
  }

  const handleQFormIncoming = function (eventType, payload) {
    client.updateConversationState({questions: payload.questions,needsHuman: payload.needsHuman})
    console.log('form sent to user');
    //client.addTextResponse('Say anything to start the questions');
    askQuestions.prompt();
    client.done();
  }

  const toggleNeedHuman = function (eventType, payload) {
    client.updateConversationState({needsHuman: payload.needsHuman})
    console.log('A Human has solved the problem');
    client.done()
  }
  const humanMessage = function (eventType, payload) {
    client.addTextResponse(payload.message)
    console.log('A human message was sent');
    client.done()
  }
  const humanResponse = function (eventType, payload) {
    const questions = client.getConversationState().questions;
    const currentQuestion = questions.find(q => q.isAsking);

    if (currentQuestion) {
      currentQuestion.isAsking = false;
      currentQuestion.answer = payload.text;
    }

    client.updateConversationState({needsHuman: false, questions: questions});

    askQuestions.prompt()
  }

  const reset = client.createStep({
    satisfied() {
      return false;
    },
    prompt() {
      client.resetConversationState();
      client.done();
    }
  })

  client.runFlow({
    eventHandlers: {
      '*': handleRenegadeEvent,
      'incoming:QForm': handleQFormIncoming,
      'incoming:human:message': humanMessage,
      'incoming:human:response': humanResponse,
      'toggleState:needHuman': toggleNeedHuman,
    },
    classifications: {
      'reset/reset': 'reset'
    },
    streams: {
      main: 'loop',
      loop: [waitForNurse, askQuestions],
      reset: [reset]
    },
  })
}
