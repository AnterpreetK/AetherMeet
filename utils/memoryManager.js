/**
 * Memory Management Utilities for AetherMeet
 * Handles cleanup of inactive rooms, expired data, and memory optimization
 */

const Room = require('../models/Room');
const Message = require('../models/Message');
const Analytics = require('../models/Analytics');

class MemoryManager {
    constructor() {
        this.cleanupInterval = null;
        this.stats = {
            roomsCleaned: 0,
            messagesCleaned: 0,
            lastCleanup: null,
            memoryUsage: process.memoryUsage()
        };
    }

    /**
     * Start automatic cleanup processes
     * @param {number} intervalMinutes - How often to run cleanup (default: 30 minutes)
     */
    startCleanup(intervalMinutes = 30) {
        console.log(`🧹 Starting memory cleanup every ${intervalMinutes} minutes`);
        
        this.cleanupInterval = setInterval(async () => {
            await this.performCleanup();
        }, intervalMinutes * 60 * 1000);

        // Run initial cleanup
        setTimeout(() => this.performCleanup(), 5000);
    }

    /**
     * Stop automatic cleanup
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('🛑 Memory cleanup stopped');
        }
    }

    /**
     * Perform comprehensive cleanup
     */
    async performCleanup() {
        const startTime = Date.now();

        try {
            // 1. Clean expired demo rooms
            await this.cleanExpiredDemoRooms();
            
            // 2. Clean inactive authenticated rooms (optional)
            await this.cleanInactiveRooms();
            
            // 3. Clean old messages from destroyed rooms
            await this.cleanOrphanedMessages();
            
            // 4. Clean old analytics data (TTL should handle this, but double-check)
            await this.cleanOldAnalytics();
            
            // 5. Update memory statistics
            this.updateMemoryStats();
            
            const duration = Date.now() - startTime;
            console.log(`✅ Memory cleanup completed in ${duration}ms`);
            console.log(`📊 Cleanup stats: ${this.stats.roomsCleaned} rooms, ${this.stats.messagesCleaned} messages cleaned`);
            
        } catch (error) {
            console.error('❌ Memory cleanup error:', error);
        }
    }

    /**
     * Clean expired demo rooms (past 24 hours)
     */
    async cleanExpiredDemoRooms() {
        const expiredRooms = await Room.find({
            isDemoRoom: true,
            $or: [
                { expiresAt: { $lt: new Date() } },
                { createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
            ]
        });

        for (const room of expiredRooms) {
            try {
                // Mark room as inactive if not already
                if (room.isActive) {
                    room.isActive = false;
                    room.destroyedAt = new Date();
                    await room.save();
                    console.log(`🗑️  Expired demo room cleaned: ${room.roomCode}`);
                }
                
                // Clean associated messages
                await Message.deleteMany({ roomCode: room.roomCode });
                
                this.stats.roomsCleaned++;
            } catch (error) {
                console.error(`❌ Error cleaning expired room ${room.roomCode}:`, error);
            }
        }
    }

    /**
     * Clean inactive authenticated rooms (empty for more than 7 days)
     */
    async cleanInactiveRooms() {
        const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
        
        const inactiveRooms = await Room.find({
            isDemoRoom: false,
            isActive: true,
            members: { $size: 0 },
            'analytics.lastActivity': { $lt: inactiveThreshold }
        });

        for (const room of inactiveRooms) {
            try {
                console.log(`⚠️  Marking inactive authenticated room for cleanup: ${room.roomCode} (empty for 7+ days)`);
                // Don't auto-delete authenticated rooms, just log for admin review
                // Optionally: room.isActive = false; await room.save();
            } catch (error) {
                console.error(`❌ Error processing inactive room ${room.roomCode}:`, error);
            }
        }
    }

    /**
     * Clean messages from destroyed/inactive rooms
     */
    async cleanOrphanedMessages() {
        // Get room codes of active rooms
        const activeRoomCodes = await Room.find({ isActive: true }).distinct('roomCode');
        
        // Delete messages from inactive rooms
        const deleteResult = await Message.deleteMany({
            roomCode: { $nin: activeRoomCodes }
        });

        if (deleteResult.deletedCount > 0) {
            console.log(`🗑️  Cleaned ${deleteResult.deletedCount} orphaned messages`);
            this.stats.messagesCleaned += deleteResult.deletedCount;
        }
    }

    /**
     * Clean old analytics data (backup to TTL)
     */
    async cleanOldAnalytics() {
        const oldThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
        
        const deleteResult = await Analytics.deleteMany({
            timestamp: { $lt: oldThreshold }
        });

        if (deleteResult.deletedCount > 0) {
            console.log(`📊 Cleaned ${deleteResult.deletedCount} old analytics records`);
        }
    }

    /**
     * Update memory usage statistics
     */
    updateMemoryStats() {
        const memUsage = process.memoryUsage();
        this.stats.memoryUsage = memUsage;
        this.stats.lastCleanup = new Date();
        
        console.log(`💾 Memory usage: RSS ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    }

    /**
     * Get current memory statistics
     */
    getStats() {
        return {
            ...this.stats,
            uptime: process.uptime(),
            memoryMB: {
                rss: Math.round(this.stats.memoryUsage.rss / 1024 / 1024),
                heapUsed: Math.round(this.stats.memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(this.stats.memoryUsage.heapTotal / 1024 / 1024)
            }
        };
    }

    /**
     * Force immediate cleanup (for manual triggers)
     */
    async forceCleanup() {
        console.log('🚀 Force cleanup triggered');
        await this.performCleanup();
        return this.getStats();
    }

    /**
     * Get room statistics for monitoring
     */
    async getRoomStats() {
        const stats = await Room.aggregate([
            {
                $group: {
                    _id: null,
                    totalRooms: { $sum: 1 },
                    activeRooms: { $sum: { $cond: ['$isActive', 1, 0] } },
                    demoRooms: { $sum: { $cond: ['$isDemoRoom', 1, 0] } },
                    emptyRooms: { $sum: { $cond: [{ $eq: [{ $size: '$members' }, 0] }, 1, 0] } }
                }
            }
        ]);

        const messageCount = await Message.countDocuments();
        
        return {
            ...stats[0],
            totalMessages: messageCount,
            lastUpdated: new Date()
        };
    }
}

module.exports = new MemoryManager();
