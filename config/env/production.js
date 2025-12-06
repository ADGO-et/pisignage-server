module.exports = {
    env: 'production',
    https: false,
    port: process.env.PORT || 1242,
    mongo: {
        uri: process.env.MONGODB_URI ||
            'mongodb+srv://your-atlas-connection-string-here'
    }
};
