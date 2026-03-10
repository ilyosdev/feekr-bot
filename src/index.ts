// Removed conversations import - using simpler approach
import * as dotenv from 'dotenv';
import { Bot, Context, InlineKeyboard, MemorySessionStorage, session, SessionFlavor } from 'grammy';
import { submitFeedback, validateQrCode, getStaffByLocation, findOrCreateCustomer, checkUser } from './api';

dotenv.config();

interface ConversationState {
  qrToken: string; 
  locationId: number; 
  staffId?: number;
  qrType: 'location' | 'staff';
  locationName?: string;
  staffName?: string;
  staffPosition?: string;
  businessName?: string;
  selectedStaffId?: number;
  step: 'staff_selection' | 'found_question' | 'info_question' | 'rating' | 'additional_feedback' | 'completed';
  foundWhatWanted?: boolean;
  gotEnoughInfo?: boolean;
  staffRating?: number;
  additionalComments?: string;
}

interface SessionData {
  qrToken?: string;
  locationId?: number;
  conversationState?: ConversationState;
  isInConversation?: boolean;
  lastActivity?: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

// Global storage for passing data to conversations (fallback for session issues)
const conversationDataStore = new Map<number, ConversationState>();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in the environment variables');
}

const FEEDBACK_QUESTIONS = {
  WELCOME: 'Assalomu alaykum! Fikr-mulohaza qoldirish uchun ism va familiyangizni kiriting:',
  STAFF_NAME: "Sizga xizmat ko'rsatgan xodim ismini kiriting (agar bo'lsa):",
  FOUND_WHAT_THEY_WANTED: "O'zingiz xohlagan narsani topdingizmi? (Ha / Yo'q)",
  GOT_ENOUGH_INFO: "Kerakli ma'lumotni oldingizmi? (Ha / Yo'q)",
  STAFF_RATING: "Xizmat sifatiga qanday baho berasiz? (1 dan 10 gacha)",
  ADDITIONAL_FEEDBACK: "Agar sizda qo'shimcha fikr va izohlar yoki takliflar mavjud bo'lsa quyida qoldiring:",
  SKIP_FEEDBACK: "O'tkazib yuborish ⏭️",
  CANCEL: "❌ Bekor qilish",
  THANKS: 'Rahmat! Fikr-mulohazangiz biz uchun muhim.',
  CANCELLED: 'Fikr-mulohaza berish bekor qilindi. QR kodni qaytadan skanerlang yoki /start buyrug\'ini ishlating.',
  ERROR: "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
  INVALID_QR: 'Bu QR kod yaroqsiz. Iltimos, toʻgʻri QR koddan foydalaning.',
  INVALID_RATING: "Iltimos, 1 dan 10 gacha bo'lgan raqam kiriting.",
  INVALID_YES_NO: 'Iltimos, "Ha" yoki "Yo\'q" javobini kiriting.',
  SELECT_STAFF: "Sizga kim xizmat ko'rsatdi? Quyidagi ro'yxatdan tanlang:",
  NO_STAFF_AVAILABLE: "Ushbu filialda hozircha xodimlar ro'yxati mavjud emas.",
};

const bot = new Bot<MyContext>(BOT_TOKEN);

// Set up session middleware with memory storage
bot.use(
  session({
    storage: new MemorySessionStorage<SessionData>(),
    initial: (): SessionData => ({
      qrToken: undefined,
      locationId: undefined,
      conversationState: undefined,
      isInConversation: false,
      lastActivity: Date.now(),
    }),
  })
);

// Remove conversations plugin - using simpler approach
// bot.use(conversations());

// Simple middleware for session management
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();

  // Update last activity timestamp
  if (ctx.session) {
    ctx.session.lastActivity = Date.now();
  }

  // Check if this is a new QR scan (/start command with token)
  if (ctx.message?.text?.startsWith('/start ')) {
    const token = ctx.message.text.split(' ')[1];
    if (token && ctx.session?.isInConversation) {
      console.log('New QR scan detected during active feedback:', token);
      await handleNewQrScanDuringFeedback(ctx, token);
      return; // Don't continue to other handlers
    }
  }

  // Check if this is a cancel command during feedback
  if (ctx.message?.text === '/cancel' && ctx.session?.isInConversation) {
    console.log('Cancel command detected during feedback');
    await handleCancelDuringFeedback(ctx);
    return; // Don't continue to other handlers
  }

  await next();
});

// Helper functions for handling interruptions
async function handleNewQrScanDuringFeedback(ctx: MyContext, token: string) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    console.log('Validating new QR code during feedback...');
    const { data: validation } = await validateQrCode(token);

    if (validation.isValid && validation.qrCode) {
      // Clear current feedback session
      if (ctx.session) {
        ctx.session.conversationState = undefined;
        ctx.session.isInConversation = false;
      }
      conversationDataStore.delete(chatId);

      // Store new QR data in session
      const { qrCode } = validation;
      if (!ctx.session) {
        ctx.session = {
          qrToken: undefined,
          locationId: undefined,
          conversationState: undefined,
          isInConversation: false,
          lastActivity: Date.now(),
        };
      }

      const newConversationState: ConversationState = {
        qrToken: token,
        locationId: qrCode.locationId,
        staffId: qrCode.staffId,
        qrType: qrCode.type,
        locationName: qrCode.location?.name,
        staffName: qrCode.staff?.name,
        staffPosition: qrCode.staff?.position,
        businessName: qrCode.location?.name || 'Business',
        step: 'staff_selection'
      };

      ctx.session.conversationState = newConversationState;
      ctx.session.isInConversation = false; // Reset feedback flag

      // Update global store with new data
      conversationDataStore.set(chatId, newConversationState);

      await ctx.reply("🔄 Yangi QR kod skanerlandi! Yangi feedback boshlayapmiz...");

      // Check if customer exists
      let customerExists = false;
      try {
        const response = await checkUser(String(chatId));
        customerExists = !!response.data;
      } catch (error) {
        console.log('Error checking customer:', error);
      }

      // If new user, require contact sharing
      if (!customerExists) {
        await ctx.reply(
          "👋 Assalomu alaykum! Bizning feedback tizimimizga xush kelibsiz!\n\n" +
          "📱 Davom etish uchun telefon raqamingizni ulashing:",
          {
            reply_markup: {
              keyboard: [
                [{ text: "📱 Telefon raqamini ulashish", request_contact: true }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        return;
      }

      // Start new feedback process for returning users
      await handleFeedbackStep(ctx, newConversationState);
    } else {
      await ctx.reply("❌ Yangi QR kod yaroqsiz.");
    }
  } catch (error) {
    console.error('Error handling new QR scan during feedback:', error);
    await ctx.reply("❌ Yangi QR kodni qayta ishlashda xatolik.");
  }
}

async function handleCancelDuringFeedback(ctx: MyContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Clear session data
  if (ctx.session) {
    ctx.session.conversationState = undefined;
    ctx.session.isInConversation = false;
  }
  conversationDataStore.delete(chatId);

  await ctx.reply(FEEDBACK_QUESTIONS.CANCELLED);
}

// Removed waitForInputWithTimeout - using callback handlers instead

// Simple feedback handler
async function handleFeedbackStep(ctx: MyContext, state: ConversationState) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const { qrToken, locationId, staffId, qrType, locationName, staffName, staffPosition, businessName } = state;

  // Ensure session is initialized
  if (!ctx.session) {
    ctx.session = {
      qrToken: undefined,
      locationId: undefined,
      conversationState: undefined,
      isInConversation: false,
      lastActivity: Date.now(),
    };
  }

  // Mark as in conversation
  ctx.session.isInConversation = true;
  ctx.session.conversationState = state;

  // Show welcome message only for the first step
  if (state.step === 'staff_selection') {
    const businessHeader = businessName ? `🏢 ${businessName}\n\n` : '';

    if (qrType === 'staff') {
      if (staffName) {
        await ctx.reply(`👋 Xush kelibsiz!\n\n${businessHeader}🎯 Siz "${staffName}" (${staffPosition}) xodimimizga baho berasiz\n📍 Filial: ${locationName || 'Bizning filial'}\n\nFikr-mulohazangiz biz uchun juda muhim!`);
      } else {
        await ctx.reply(`👋 Xush kelibsiz!\n\n${businessHeader}🎯 Siz filial xodimimizga baho berasiz\n📍 Filial: ${locationName || 'Bizning filial'}\n\nFikr-mulohazangiz biz uchun juda muhim!`);
      }
    } else {
      await ctx.reply(`👋 Xush kelibsiz!\n\n${businessHeader}🎯 Siz "${locationName || 'bizning filial'}" filialimizga baho berasiz\n\nXizmat sifati haqida fikr-mulohazangizni bilishdan mamnunmiz!`);
    }
  }

  // Handle staff selection for location QR
  if (state.step === 'staff_selection' && qrType === 'location') {
    try {
      const { data: staffList } = await getStaffByLocation(locationId);

      if (staffList && staffList.length > 0) {
        const staffKeyboard = new InlineKeyboard();

        for (let i = 0; i < staffList.length; i += 2) {
          if (i + 1 < staffList.length) {
            staffKeyboard
              .text(`${staffList[i].name} (${staffList[i].position})`, `staff_${staffList[i].id}`)
              .text(`${staffList[i + 1].name} (${staffList[i + 1].position})`, `staff_${staffList[i + 1].id}`)
              .row();
          } else {
            staffKeyboard
              .text(`${staffList[i].name} (${staffList[i].position})`, `staff_${staffList[i].id}`)
              .row();
          }
        }

        staffKeyboard.text("Aniq xodim yo'q ❌", 'staff_none').row()
          .text(FEEDBACK_QUESTIONS.CANCEL, 'cancel_feedback');

        await ctx.reply(FEEDBACK_QUESTIONS.SELECT_STAFF, {
          reply_markup: staffKeyboard
        });

        // Move to next step - callback handler will process the response
        state.step = 'found_question';
        ctx.session.conversationState = state;
        conversationDataStore.set(chatId, state);
      } else {
        await ctx.reply(FEEDBACK_QUESTIONS.NO_STAFF_AVAILABLE);
        state.step = 'found_question';
        ctx.session.conversationState = state;
        conversationDataStore.set(chatId, state);
        await showNextQuestion(ctx, state, chatId);
      }
    } catch (error) {
      console.error('Error fetching staff list:', error);
      state.step = 'found_question';
      ctx.session.conversationState = state;
      conversationDataStore.set(chatId, state);
      await showNextQuestion(ctx, state, chatId);
    }
  } else {
    // For staff QR or continuing from previous step
    await showNextQuestion(ctx, state, chatId);
  }
}

// Helper function to show the appropriate question based on current step
async function showNextQuestion(ctx: MyContext, state: ConversationState, chatId: number) {
  switch (state.step) {
    case 'found_question':
      const foundKeyboard = new InlineKeyboard()
        .text('Ha ✅', 'found_yes')
        .text('Yo\'q ❌', 'found_no').row()
        .text(FEEDBACK_QUESTIONS.CANCEL, 'cancel_feedback');

      await ctx.reply(FEEDBACK_QUESTIONS.FOUND_WHAT_THEY_WANTED, {
        reply_markup: foundKeyboard
      });
      break;

    case 'info_question':
      const infoKeyboard = new InlineKeyboard()
        .text('Ha ✅', 'info_yes')
        .text('Yo\'q ❌', 'info_no').row()
        .text(FEEDBACK_QUESTIONS.CANCEL, 'cancel_feedback');

      await ctx.reply(FEEDBACK_QUESTIONS.GOT_ENOUGH_INFO, {
        reply_markup: infoKeyboard
      });
      break;

    case 'rating':
      const ratingKeyboard = new InlineKeyboard()
        .text('1', 'rating_1').text('2', 'rating_2').text('3', 'rating_3').text('4', 'rating_4').text('5', 'rating_5').row()
        .text('6', 'rating_6').text('7', 'rating_7').text('8', 'rating_8').text('9', 'rating_9').text('10', 'rating_10').row()
        .text(FEEDBACK_QUESTIONS.CANCEL, 'cancel_feedback');

      await ctx.reply(FEEDBACK_QUESTIONS.STAFF_RATING, {
        reply_markup: ratingKeyboard
      });
      break;

    case 'additional_feedback':
      const feedbackKeyboard = new InlineKeyboard()
        .text(FEEDBACK_QUESTIONS.SKIP_FEEDBACK, 'skip_feedback')
        .text(FEEDBACK_QUESTIONS.CANCEL, 'cancel_feedback');

      await ctx.reply(FEEDBACK_QUESTIONS.ADDITIONAL_FEEDBACK, {
        reply_markup: feedbackKeyboard
      });
      break;
  }
}

// Simplified customer handling - just create/update customer record
async function ensureCustomerExists(ctx: MyContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  
  try {
    const customerData = {
      telegramChatId: String(chatId),
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      username: ctx.from?.username,
    };
    
    // Create or update customer record (API handles this automatically)
    await findOrCreateCustomer(customerData);
  } catch (error) {
    console.error('Error ensuring customer exists:', error);
    // Continue regardless - API will handle missing customer gracefully
  }
}

// Handle contact sharing and continue with feedback
bot.on('message:contact', async (ctx) => {
  const contact = ctx.message.contact;
  const chatId = ctx.chat?.id;
  
  if (!chatId || !contact) return;
  
  try {
    // Create customer with phone number
    await findOrCreateCustomer({
      telegramChatId: String(chatId),
      firstName: contact.first_name,
      lastName: contact.last_name,
      phoneNumber: contact.phone_number,
    });
    
    await ctx.reply("✅ Rahmat! Telefon raqamingiz saqlandi.", {
      reply_markup: { remove_keyboard: true }
    });
    
    // Check if we have stored conversation state to continue with feedback
    if (ctx.session?.conversationState && ctx.session.conversationState.qrToken) {
      await ctx.reply("🎯 Endi feedback berishni davom ettiramiz...");
      // Ensure session is properly initialized
      if (!ctx.session) {
        ctx.session = {
          qrToken: undefined,
          locationId: undefined,
          conversationState: undefined,
          isInConversation: false,
          lastActivity: Date.now(),
        };
      }
      // Continue with the feedback process using stored state
      if (ctx.session.conversationState) {
        await handleFeedbackStep(ctx, ctx.session.conversationState);
      }
    } else {
      // No stored QR data, ask to scan QR code
      await ctx.reply("🔍 Endi QR kodni skanerlang yoki havolani bosing.");
    }
    
  } catch (error) {
    console.error('Error saving contact:', error);
    await ctx.reply("❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.");
  }
});

// Conversation already registered above

// Handle cancel command
bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) {
    // Clear session data
    if (ctx.session) {
      ctx.session.conversationState = undefined;
      ctx.session.isInConversation = false;
    }
    // Clear global store
    conversationDataStore.delete(chatId);

    console.log('Cancelled feedback session for chat:', chatId);
  }
  await ctx.reply(FEEDBACK_QUESTIONS.CANCELLED);
});

// Handle the start command
bot.command('start', async (ctx) => {
  const startParam = ctx.message?.text?.split(' ')[1];
  const chatId = ctx.chat?.id;
  
  console.log('Start command received');
  console.log('Start param:', startParam);
  console.log('Chat ID:', chatId);
  
  if (!startParam || !chatId) {
    await ctx.reply(
      "👋 Assalomu alaykum! Feedback berish uchun QR kodni skanerlang yoki to'g'ri havolani bosing."
    );
    return;
  }

  const token = startParam;
  console.log(`User started with token: ${token}`);

  try {
    console.log('Validating QR code...');
    const { data: validation } = await validateQrCode(token);
    console.log('Validation result:', validation);
    
    if (validation.isValid && validation.qrCode) {
      console.log('QR code is valid, checking customer...');
      
      // Check if customer exists in database
      let customerExists = false;
      try {
        const response = await checkUser(String(chatId));
        customerExists = !!response.data;
        console.log('Customer exists:', customerExists);
      } catch (error) {
        console.log('Error checking customer:', error);
      }
      
      // Store QR data in session (needed for both new and returning users)
      const { qrCode } = validation;
      if (!ctx.session) {
        ctx.session = {
          qrToken: undefined,
          locationId: undefined,
          conversationState: undefined,
          isInConversation: false,
          lastActivity: Date.now(),
        };
      }

      const conversationState: ConversationState = {
        qrToken: token,
        locationId: qrCode.locationId,
        staffId: qrCode.staffId,
        qrType: qrCode.type,
        locationName: qrCode.location?.name,
        staffName: qrCode.staff?.name,
        staffPosition: qrCode.staff?.position,
        businessName: qrCode.location?.name || 'Business',
        step: 'staff_selection'
      };

      ctx.session.conversationState = conversationState;
      // Also store in global store as backup
      conversationDataStore.set(chatId, conversationState);
      
      // If new user, require contact sharing before feedback
      if (!customerExists) {
        await ctx.reply(
          "👋 Assalomu alaykum! Bizning feedback tizimimizga xush kelibsiz!\n\n" +
          "📱 Davom etish uchun telefon raqamingizni ulashing. Bu sizga keyingi safar tezroq xizmat ko'rsatishimiz uchun zarur.\n\n" +
          "Quyidagi tugmani bosing:",
          {
            reply_markup: {
              keyboard: [
                [{ text: "📱 Telefon raqamini ulashish", request_contact: true }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        return; // Stop here and wait for contact sharing
      }
      
      console.log('Data stored for chat:', chatId);

      // Start the feedback process for returning users
      await handleFeedbackStep(ctx, conversationState);
    } else {
      console.log('QR code is invalid');
      await ctx.reply(FEEDBACK_QUESTIONS.INVALID_QR);
    }
  } catch (error) {
    console.error(`Error validating QR code ${token}:`, error);
    await ctx.reply(FEEDBACK_QUESTIONS.INVALID_QR);
  }
});

// Handle callback queries for feedback process
bot.on('callback_query:data', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery.data;

  // Get current state
  let state: ConversationState | undefined;
  if (ctx.session?.conversationState) {
    state = ctx.session.conversationState;
  } else if (conversationDataStore.has(chatId)) {
    state = conversationDataStore.get(chatId);
    if (ctx.session && state) {
      ctx.session.conversationState = state;
    }
  }

  if (!state) {
    await ctx.answerCallbackQuery('No active feedback session found.');
    return;
  }

  try {
    await ctx.answerCallbackQuery();

    // Handle cancel
    if (data === 'cancel_feedback') {
      if (ctx.session) {
        ctx.session.conversationState = undefined;
        ctx.session.isInConversation = false;
      }
      conversationDataStore.delete(chatId);
      await ctx.reply(FEEDBACK_QUESTIONS.CANCELLED);
      return;
    }

    // Handle staff selection
    if (data.startsWith('staff_')) {
      if (data === 'staff_none') {
        state.selectedStaffId = undefined;
      } else {
        state.selectedStaffId = parseInt(data.replace('staff_', ''), 10);
      }
      state.step = 'found_question';
    }

    // Handle found question
    else if (data.startsWith('found_')) {
      state.foundWhatWanted = data === 'found_yes';
      state.step = 'info_question';
    }

    // Handle info question
    else if (data.startsWith('info_')) {
      state.gotEnoughInfo = data === 'info_yes';
      state.step = 'rating';
    }

    // Handle rating
    else if (data.startsWith('rating_')) {
      state.staffRating = parseInt(data.replace('rating_', ''), 10);
      state.step = 'additional_feedback';
    }

    // Handle additional feedback
    else if (data === 'skip_feedback') {
      state.additionalComments = undefined;
      await submitAndComplete(ctx, state, chatId);
      return;
    }

    // Save state
    if (ctx.session) {
      ctx.session.conversationState = state;
    }
    conversationDataStore.set(chatId, state);

    // Show next question or complete
    if (state.step === 'additional_feedback') {
      await showNextQuestion(ctx, state, chatId);
    } else if (state.step !== 'completed') {
      await showNextQuestion(ctx, state, chatId);
    }

  } catch (error) {
    console.error('Error handling callback query:', error);
    await ctx.reply('Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
  }
});

// Handle text messages for additional feedback
bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Get current state
  let state: ConversationState | undefined;
  if (ctx.session?.conversationState) {
    state = ctx.session.conversationState;
  } else if (conversationDataStore.has(chatId)) {
    state = conversationDataStore.get(chatId);
    if (ctx.session && state) {
      ctx.session.conversationState = state;
    }
  }

  if (!state || state.step !== 'additional_feedback') {
    return; // Not in additional feedback step, let other handlers process
  }

  // Handle additional feedback text
  state.additionalComments = ctx.message.text;
  await submitAndComplete(ctx, state, chatId);
});

// Submit feedback and complete the process
async function submitAndComplete(ctx: MyContext, state: ConversationState, chatId: number) {
  try {
    console.log('Submitting feedback...');

    // Validate required fields before submission
    if (state.foundWhatWanted === undefined || state.gotEnoughInfo === undefined || state.staffRating === undefined) {
      throw new Error('Missing required feedback data');
    }

    const feedbackData = {
      locationId: state.locationId,
      staffId: state.qrType === 'staff' ? state.staffId : state.selectedStaffId,
      qrCodeToken: state.qrToken,
      foundWhatWanted: state.foundWhatWanted,
      gotEnoughInfo: state.gotEnoughInfo,
      staffRating: state.staffRating,
      telegramChatId: String(chatId),
      additionalComments: state.additionalComments,
    };

    console.log('Submitting feedback data:', feedbackData);

    await submitFeedback(feedbackData);
    console.log('Feedback submitted successfully');

    await ctx.reply(FEEDBACK_QUESTIONS.THANKS);

    // Clean up
    if (ctx.session) {
      ctx.session.conversationState = undefined;
      ctx.session.isInConversation = false;
    }
    conversationDataStore.delete(chatId);

  } catch (error) {
    console.error('Error submitting feedback:', error);
    await ctx.reply('Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');

    // Clean up on error
    if (ctx.session) {
      ctx.session.conversationState = undefined;
      ctx.session.isInConversation = false;
    }
    conversationDataStore.delete(chatId);
  }
}

// Handle any other message
bot.on('message', async (ctx) => {
  await ctx.reply('Iltimos, /start buyrug\'ini QR kod parametri bilan ishlating.');
});

// Error handler
bot.catch((err) => {
  console.error(`Error while handling update ${err.ctx.update.update_id}:`, err.error);
});

// Start the bot
async function startBot() {
  try {
    console.log('Testing bot token...');
    const botInfo = await bot.api.getMe();
    console.log(`Bot token is valid: @${botInfo.username}`);
    
    // Delete webhook if exists
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log('Webhook deleted successfully');
    } catch (error) {
      console.log('No webhook to delete (this is normal for polling mode)');
    }
    
    // Start bot with polling
    console.log('Starting bot with polling...');
    await bot.start({
      onStart: (botInfo) => {
        console.log(`✅ Bot started successfully: @${botInfo.username}`);
        console.log('Bot is now listening for messages...');
      },
    });
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    console.error('Please check your TELEGRAM_BOT_TOKEN in .env file');
    process.exit(1);
  }
}

startBot();