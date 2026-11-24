CREATE TABLE `BookingEmail` (
  `bookingId` VARCHAR(191) NOT NULL,
  `recipient` VARCHAR(254) NOT NULL,
  `verificationUrl` TEXT NOT NULL,
  `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sentAt` DATETIME(3) NULL,
  INDEX `BookingEmail_status_nextAttemptAt_idx` (`status`, `nextAttemptAt`),
  PRIMARY KEY (`bookingId`),
  CONSTRAINT `BookingEmail_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
