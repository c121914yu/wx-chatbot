import { ChatGPTAPI, ChatGPTConversation } from "chatgpt";
import { Message } from "wechaty";
import { ContactInterface,RoomInterface } from "wechaty/impls";
import { tokens } from "./config.js";
import { Cache } from "./cache.js";

interface MyMessageType {
  message:Message,
  remainAmount: number
}
interface ConversionType {
  conversion: ChatGPTConversation,
  queue:  MyMessageType[]
}

export class ChatGPTBot {
  cache = new Cache("cache.json");
  botName: string = "";
  setBotName(botName: string) {
    this.botName = botName;
  }
  chatGPTPools: ChatGPTAPI[] = []
  conversations = new Map<string, ConversionType>();

  /**
   * 开始chat GPT机器人
   */
  async startGPTBot() {
    try {
      console.log('connecting chatGPT....');
      this.chatGPTPools = await Promise.all(
        tokens.map((token) => {
            return new ChatGPTAPI({
              sessionToken: token,
            })
        })
      )
      console.log(`Chatgpt pool size: ${this.chatGPTPools.length}`);
    } catch (error) {
      console.log('连接chatGPT失败', error);
    }
  }
  
  /**
   * 平均分配实例
   */
  get chatGpt(): ChatGPTAPI {
    return this.chatGPTPools[Math.floor(Math.random()*this.chatGPTPools.length-0.001)]
  }

  /**
   * 重置对话内容
   */
  resetConversation(talkerId: string): void {
    this.conversations.set(talkerId, {
      conversion: this.chatGpt.getConversation(),
      queue: []
    });
  }

  /**
   * 获取我们的对话实例，如果未创建，则创建一个容器记录信息
   */
  getConversation(conversionId: string): ConversionType  {
    if (this.conversations.get(conversionId) === undefined) {
      this.conversations.set(conversionId,  {
        conversion: this.chatGpt.getConversation(),
        queue: []
      });
    }
    return this.conversations.get(conversionId) as ConversionType ;
  }

  /**
   * 发送message到chatGPT，等到消息返回
   */
  getGPTMessage(text: string, conversionId: string): Promise<string> {
    const conversation = this.getConversation(conversionId).conversion;
    return conversation.sendMessage(text)
  }

  /**
   * 清理message，删除一些回复内容
   */
   cleanMessage(text: string): string {
    let realText = text;
    const item = text.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      realText = item[item.length - 1];
    }
    // remove more text via - - - - - - - - - - - - - - -
    return realText;
  }

  /**
   * 获取发送实例
   */
  useSendItem(message: Message) {
    const talker = message.talker(); // 发送消息的人
    const room = message.room(); // 群聊
    const text = message.text(); // 发送的文本

    const realText = this.cleanMessage(text).replace(`archer`, "").trim(); // chatbot替换掉

    let responseItem:RoomInterface | ContactInterface = talker
    if(talker.self()) { // 自己，不能和自己say，需要获取到对方的消息
      responseItem = message.to() as ContactInterface
    }
    if(room) { // 群发消息
      responseItem = room
    }
    return {
      conversionId: responseItem.id,
      conversion: this.getConversation(responseItem.id),
      talker,
      room,
      text: realText,
      responseItem,
      say: (text: string, cut: boolean) => {
        const sendText = cut && realText.length > 15
          ?  `${realText.slice(0,12)}...\n- - - - -\n${text}` 
          : `${realText}\n ------\n${text}`
        return responseItem.say(sendText, talker)
      },
      toRecalledText: () => message.toRecalled()
    }
  }
  /**
   * 预发送。把需要发送的消息放到队列里
   */
  async preSendMessage(message: Message) {
    const { conversionId, conversion, say, responseItem, text } = this.useSendItem(message)

    /* 重置会话 */
    if(text === 'remake') {
      this.resetConversation(conversionId)
      responseItem.say("我们重新开始吧...")
      return
    }

    conversion.queue.push({
      message,
      remainAmount: 2
    })

    if(conversion.queue.length === 1) { // 只有一个消息。代表着前面没有任何内容
      await say(`给我点时间，我需要思考一下这个问题...`, true)
      this.sendMessageFn(conversion.queue[0])
    } else { // 发送排队提示语
      await say(`我需要一个个思考问题，你前面还有: ${conversion.queue.length-1}个问题`, true)
    }
  }

  /**
   * 发送消息方法，用于递归
   */
  async sendMessageFn(item: MyMessageType) {
    const { conversion, conversionId, say, toRecalledText } = this.useSendItem(item.message)

    item.remainAmount-- // 发送次数减少一次

    try {
      await this.sendMessage(item.message)
      conversion.queue.shift()
    } catch(err) {
      console.log('error: ', err);
      
      if(item.remainAmount <= 0) { // 没有发送机会了，则报错。并且重置对话内容
        conversion.queue.shift()
        await say(`出现了点意外，我挂了`, true)
        await toRecalledText()
        this.resetConversation(conversionId)
      } else { // 还有重发机会
        console.log("消息超时，重发");
        // await say(`emm, 网络有点差，我再试一试...`, true)
        // 这里不需要递归，因为下面的函数肯定会执行
      }
    }

    // 判断是否队列里，是否还有内容需要执行
    if(conversion.queue.length > 0) {
      if(conversion.queue[0].remainAmount === 2) { // 表明是下个任务
        const { say } = this.useSendItem(conversion.queue[0].message) // 需要更新say，因为say是上一个消息的缓存
        await say(`我在想这个问题`, true)
      }
      setTimeout(() => {
        this.sendMessageFn(conversion.queue[0])
      }, 1000);
    }
  }
  /**
   * 发送消息。 先请求chatGPT内容，然后发送到客户端
   */
  async sendMessage(message: Message) {
    const {conversionId,text, talker, room, say} = this.useSendItem(message)

    try {
      if (!room) { // 私人聊天
        console.log(`发消息ing: ${text}`);
        const response = await this.getGPTMessage(text, conversionId);
        await say(response, false)
        console.log(`消息已发送给: ${talker.name()}`);
        return;
      }
      
      // 群聊
      const topic = await room.topic();

      console.log(`发消息ing: ${text}`);
      const response = await this.getGPTMessage(text, conversionId);
      await say(response, false)
      console.log(`消息已发送给: ${topic}`);
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
