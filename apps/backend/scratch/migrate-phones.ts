import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("🚀 Starting phone number normalization migration...");

  const users = await prisma.user.findMany();
  
  for (const user of users) {
    const { phone } = user;
    
    // Check if it's a Mexican number that needs normalization (+52 followed by 10 digits)
    const digits = phone.replace(/^\+/, "");
    if (digits.startsWith("52") && digits.length === 12) {
      const normalized = `+521${digits.substring(2)}`;
      
      console.log(`Checking user ${phone} -> ${normalized}`);

      if (phone === normalized) continue;

      // Check if the normalized version already exists
      const targetUser = await prisma.user.findUnique({
        where: { phone: normalized }
      });

      if (targetUser) {
        console.log(`Target user ${normalized} already exists. Merging ${user.id} into ${targetUser.id}...`);
        
        // Merge transactions
        await prisma.transaction.updateMany({
          where: { userId: user.id },
          data: { userId: targetUser.id }
        });

        // Merge messages
        await prisma.conversationMessage.updateMany({
          where: { userId: user.id },
          data: { userId: targetUser.id }
        });

        // Merge alert rules
        await prisma.alertRule.updateMany({
          where: { userId: user.id },
          data: { userId: targetUser.id }
        });

        // Delete the old user
        await prisma.user.delete({
          where: { id: user.id }
        });
        
        console.log(`✅ Merged and deleted ${phone}`);
      } else {
        // Just rename
        await prisma.user.update({
          where: { id: user.id },
          data: { phone: normalized }
        });
        console.log(`✅ Renamed ${phone} to ${normalized}`);
      }
    }
  }

  console.log("🏁 Migration complete.");
}

migrate()
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
