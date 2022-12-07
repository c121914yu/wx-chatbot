import { WechatyBuilder,Message } from "wechaty";
import QRCode from "qrcode";
import { ChatGPTBot } from "./chatgpt.js";
const chatGPTBot = new ChatGPTBot();

const bot = WechatyBuilder.build({
  name: "wechat-assistant", 
});

const messageQueue:Message[] = []

async function sendMessage() {
  try {
    messageQueue[0] && await chatGPTBot.onMessage(messageQueue[0]);
    messageQueue.shift()
  } catch (e) {
    console.error('发送消息出错了===',e);
  }
  if(messageQueue.length > 0) {
    setTimeout(() => {
      sendMessage()
    }, 1000);
  }
}

bot
  .on("scan", async (qrcode, status) => { // 扫码
    const url = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
    console.log(`Scan QR Code to login: ${status}\n${url}`);
    console.log(
      await QRCode.toString(qrcode, { type: "terminal", small: true })
    );
  })
  .on("login", async (user) => { 
    console.log(`User ${user} logged in`);
    chatGPTBot.setBotName(user.name());
    await chatGPTBot.startGPTBot();
  })
  .on("message", async (message) => {
    if (message.text().includes("/ping")) {
      await message.say("pong");
      return;
    }
    const text = message.text(); // 发送的文本
    if (!text.startsWith(`chatbot`)) {
      return;
    }

    messageQueue.push(message)
    console.log(`收到一条消息: ${text}`);
    if(messageQueue.length === 1) {
      sendMessage()
    }
  })
  .on("error",(error) => {
    console.log("error: ", error);
  })


bot.start();
