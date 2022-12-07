import { WechatyBuilder,Message } from "wechaty";
import QRCode from "qrcode";
import { ChatGPTBot } from "./chatgpt.js";
const chatGPTBot = new ChatGPTBot();

const bot = WechatyBuilder.build({
  name: "wechat-assistant", 
});

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

    if (!text.startsWith(`archer`)) {
      return;
    }

    console.log(`收到一条消息：${text}`);

    chatGPTBot.preSendMessage(message)
  })
  .on("error",(error) => {
    console.log("error: ", error);
  })
bot.start();
