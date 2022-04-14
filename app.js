const Sequelize = require('sequelize');

async function init() {
    const dbcfg = require('./etc/db.json');
    let db = new Sequelize.Sequelize({ ...dbcfg, logging: false });
    global.db = db;
    try {
        await db.authenticate();
        console.log(`Connected to DB`);
    } catch (error) {
        console.error('Unable to connect to the DB:', error);
        process.exit(255);
    }

    await require('./dbModels');
    await require('./tgbot').init();
    require('./pointmic');
}
init();

setInterval(() => {
    //
}, 10000);