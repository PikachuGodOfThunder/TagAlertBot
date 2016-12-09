/****************************************************/
//   TagAlertBot (https://telegram.me/tagalertbot)  //
//   Simple notifications for mentions              //
//                                                  //
//   Author: Antonio Pitasi (@Zaphodias)            //
//   2016 - made with love                          //
/****************************************************/

var util = require('util');
var replies = require('./replies.js');
var config = require('./config.js')
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(config.dbPath);
var TelegramBot = require('node-telegram-bot-api');

var bot = new TelegramBot(config.token, {polling: {timeout: 1, interval: 1000}});

// Send a message to the admin when bot starts
bot.getMe().then(function (me) {
  bot.sendMessage(config.adminId, util.format(replies.booting, me.username));
});

function removeUser(username) {
  if (!username) return;
  db.run("DELETE FROM users WHERE username=?", username, function(err) {
    if (err) {
      return;
    }
    console.log("Removing @%s from database", username);
  });
}

function addUser(username, userId) {
  if (!username || !userId) return;
  var loweredUsername = username.toLowerCase();
  db.run("INSERT INTO users VALUES (?, ?)", userId, loweredUsername, function(err, res) {
    if (err) {
      // User already in db, updating him
      db.run("UPDATE users SET username=? WHERE id=?", loweredUsername, userId, function (err, res) {
        if(err) return;
      });
    }
    else
      console.log("Added @%s (%s) to database", loweredUsername, userId);
  });
}

function notifyUser(username, msg) {
  db.each("SELECT id FROM users WHERE username=?", username.toLowerCase(), function(err, row) {
    if (err) {
      return;
    }

    bot.getChatMember(msg.chat.id, row.id).then(function(res) {
      if (res.status !== 'left' && res.status !== 'kicked') {
        // User is inside in the group
        var from = util.format('%s %s %s',
          msg.from.first_name,
          msg.from.last_name ? msg.from.last_name : '',
          msg.from.username ? `(@${msg.from.username})` : ''
        );
        var btn = {inline_keyboard:[[{text: replies.retrieve}]]};
        if (msg.chat.username)
          btn.inline_keyboard[0][0].url = `telegram.me/${msg.chat.username}/${msg.message_id}`;
        else
          btn.inline_keyboard[0][0].callback_data = `/retrieve_${msg.message_id}_${-msg.chat.id}`;
        
        if (msg.photo) {
          var final_text = util.format(replies.main_caption, from, msg.chat.title, msg.caption)
          var file_id = msg.photo[0].file_id
          bot.sendPhoto(row.id, file_id, {caption: final_text, reply_markup: btn}).then(function(){}, function(){});
        }
        else {
          var final_text = util.format(replies.main_text, from, msg.chat.title, msg.text)
          bot.sendMessage(row.id,
                          final_text,
                          {parse_mode: 'HTML',
                           reply_markup: btn}).then(function(){}, function(){});
        }

      }
    });
  });
}

function retrievedTimes(messageId, groupId) {
  // TODO: store in database how many times a message is retrieved
  //       return the number and add +1 to the counter
  return 0;
}

bot.on('callback_query', function (call) {
  var splitted = call.data.split('_');
  if (splitted[0] === '/retrieve') {
    var messageId = splitted[1];
    var groupId = splitted[2];

    var times = retrievedTimes(messageId, groupId);
    if (times < config.retrievesLimit) {
      bot.sendMessage(-parseInt(groupId),
                      util.format(replies.retrieve_group, call.from.username?call.from.username:call.from.first_name),
                      {reply_to_message_id: parseInt(messageId)});
      bot.answerCallbackQuery(call.id, replies.retrieve_success, false);
    }
    else
      bot.answerCallbackQuery(call.id, replies.retrieve_limit_exceeded, true);
  }
});

bot.onText(/\/start/, function (msg) {
  if (msg.chat.type === 'private')
    bot.sendMessage(msg.chat.id, replies.start_private, {parse_mode: 'HTML'});
});

bot.onText(/^\/info$|^\/info@TagAlertBot$/gi, function (msg) {
 if (msg.chat.type != 'private')
   bot.sendMessage(msg.chat.id, replies.start_group);
 else if (!msg.from.username)
   bot.sendMessage(msg.chat.id, replies.no_username);
 else 
   bot.sendMessage(msg.chat.id, replies.start_private, {parse_mode: 'HTML'});
});

bot.on('message', function (msg) {
  addUser(msg.from.username, msg.from.id);

  if (msg.chat.type !== 'group' &&
      msg.chat.type !== 'supergroup') return;

  var alreadyNotified = new Set();
  if (msg.text && msg.entities)
    for (var i in msg.entities) {
      var entity = msg.entities[i];
      if (entity.type === 'mention') {
        var username = msg.text.substring(entity.offset + 1, entity.offset + entity.length)
                               .toLowerCase()
        var isEqual = function(u1, u2) {if (u1 && u2) return u1.toLowerCase() === u2.toLowerCase(); else return false;}
        if (!alreadyNotified.has(username) && !isEqual(msg.from.username, username)) {
          notifyUser(username, msg);
          alreadyNotified.add(username);
        }
      }
    }

  else if (msg.caption) {
    var matched = msg.caption.match(/@[a-z0-9]*/gi);
    for (var i in matched) {
      var username = matched[i].trim().substring(1).toLowerCase()
      var isEqual = function(u1, u2) {if (u1 && u2) return u1.toLowerCase() === u2.toLowerCase(); else return false;}
      if (!alreadyNotified.has(username) && !isEqual(msg.from.username, username)) {
        notifyUser(username, msg);
        alreadyNotified.add(username);
      }
    }
  }
});