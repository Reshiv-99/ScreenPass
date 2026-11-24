CREATE TABLE `PaymentAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `showId` VARCHAR(191) NOT NULL,
  `requestId` CHAR(36) NOT NULL,
  `seatIds` JSON NOT NULL,
  `amountPaise` INTEGER NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `status` ENUM('HOLD', 'CONFIRMED', 'FAILED', 'REVIEW') NOT NULL DEFAULT 'HOLD',
  `orderId` VARCHAR(191) NULL,
  `paymentId` VARCHAR(191) NULL,
  `bookingId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PaymentAttempt_userId_requestId_key` (`userId`, `requestId`),
  UNIQUE INDEX `PaymentAttempt_orderId_key` (`orderId`),
  UNIQUE INDEX `PaymentAttempt_paymentId_key` (`paymentId`),
  UNIQUE INDEX `PaymentAttempt_bookingId_key` (`bookingId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PaymentAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PaymentAttempt_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `Show`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PaymentAttempt_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ShowSeat` ADD COLUMN `holdId` VARCHAR(191) NULL, ADD COLUMN `holdUntil` DATETIME(3) NULL,
  ADD INDEX `ShowSeat_holdId_idx` (`holdId`),
  ADD CONSTRAINT `ShowSeat_holdId_fkey` FOREIGN KEY (`holdId`) REFERENCES `PaymentAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
