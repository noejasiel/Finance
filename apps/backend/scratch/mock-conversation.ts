import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function mockConversation() {
  const phone = "+5215583539764";
  const user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    console.error("User not found");
    return;
  }

  // Clear existing messages to make it clean
  await prisma.conversationMessage.deleteMany({
    where: { userId: user.id }
  });

  const messages = [
    {
      role: "user",
      content: "olvida mis gastos",
      createdAt: new Date(Date.now() - 60000 * 5)
    },
    {
      role: "assistant",
      content: "⚠️ *¿Estás seguro?*\n\nEsto eliminará *todos* tus movimientos de todo el historial.\n\nResponde *sí* para confirmar o *no* para cancelar.",
      parseResult: {
         intent: "reset_data",
         needs_confirmation: true,
         reset_timeframe: "all"
      },
      createdAt: new Date(Date.now() - 60000 * 4)
    },
    {
      role: "user",
      content: "no pendejo, nomas los de hoy",
      createdAt: new Date(Date.now() - 60000 * 3)
    },
    {
      role: "assistant",
      content: "⚠️ *¿Estás seguro?*\n\nEsto eliminará *todos* tus movimientos de hoy.\n\nResponde *sí* para confirmar o *no* para cancelar.",
      parseResult: {
         intent: "reset_data",
         needs_confirmation: true,
         reset_timeframe: "day"
      },
      createdAt: new Date(Date.now() - 60000 * 2)
    },
    {
      role: "user",
      content: "si dale",
      createdAt: new Date(Date.now() - 60000 * 1)
    },
    {
      role: "assistant",
      content: "🧹 *Cuenta limpia*\n\nSe eliminaron *2* movimientos de hoy.\n\nTu dashboard ya refleja los cambios. ¡Empezamos de cero! 💪",
      createdAt: new Date()
    }
  ];

  for (const msg of messages) {
    await prisma.conversationMessage.create({
      data: {
        userId: user.id,
        role: msg.role,
        content: msg.content,
        parseResult: msg.parseResult ? (msg.parseResult as any) : undefined,
        createdAt: msg.createdAt
      }
    });
  }

  console.log("Mock conversation injected!");
}

mockConversation().finally(() => prisma.$disconnect());
