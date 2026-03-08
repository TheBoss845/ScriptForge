const ClaudeAI = require('claude-api');

const claudeService = {
    generateScript: async (topic) => {
        // Call to Claude AI to generate script
        return await ClaudeAI.generateScript(topic);
    },

    analyzeYouTubeVideo: async (videoUrl) => {
        // Call to Claude AI for YouTube video analysis
        return await ClaudeAI.analyzeVideo(videoUrl);
    },

    generateTitle: async (keywords) => {
        // Call to Claude AI to generate title based on keywords
        return await ClaudeAI.generateTitle(keywords);
    }
};

module.exports = claudeService;