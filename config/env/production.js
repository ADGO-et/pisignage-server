module.exports = {
    env: 'production',
    https: false,
    port: process.env.PORT || 1242,
    mongo: {
        uri: process.env.MONGODB_URI ||
            'mongodb+srv://melakeselamyitbarek2012:12345678Mm@cluster0.zyndjpl.mongodb.net/?appName=Cluster0'
    }
};
