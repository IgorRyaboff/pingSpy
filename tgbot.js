const Sequelize = require('sequelize');
/** @type {Sequelize.Sequelize} */ const db = global.db;
const Telegraf = require('telegraf');
const bot = new Telegraf.Telegraf(require('./etc/tg.json').token);
const fs = require('fs');
const path = require('path');
const cryptoJs = require('crypto-js');

const mm = { text: 'MM', callback_data: 'mainMenu' };

async function tgByMonitor(monitor) {
    let owner = await db.models.User.findByPk(monitor.owner);
    return owner && owner.telegram ? owner.telegram : null;
}
async function tgByPoint(point) {
    let owner = await db.models.User.findByPk(point.owner);
    return owner && owner.telegram ? owner.telegram : null;
}

/** @param {Telegraf.Context} ctx */
async function getUser(ctx, requireAdmin = false) {
    let u = await db.models.User.findOne({ where: { telegram: ctx.chat.id } });
    return u && (u.isAdmin || !requireAdmin) ? u : null;
}
function textAction(user) {
    let r = user.telegramTextAction;
    user.telegramTextAction = null;
    user.save();
    return r;
}

async function monitorStatusChanged(m, oldStatus) {
    let chat = await tgByMonitor(m);
    if (chat) bot.telegram.sendMessage(chat, `${m.status == 'up' ? '🟢' : '🔴'} Monitor "${m.description}" status changed from ${oldStatus.toUpperCase()} to ${m.status.toUpperCase()}`);
}

async function pointStatusChanged(p, oldStatus) {
    let chat = await tgByPoint(p);
    if (chat) bot.telegram.sendMessage(chat, `${p.status == 'up' ? '🟢' : '🔴'} Point #${p.id} status changed from ${oldStatus.toUpperCase()} to ${p.status.toUpperCase()}`);
}

/** @param {Telegraf.Context} ctx */
async function mainMenu(ctx) {
    let user = await getUser(ctx);
    if (user) textAction(user);

    ctx.reply('Choose action', {
        reply_markup: {
            inline_keyboard: user ? [
                [{ text: 'Monitors', callback_data: 'monitors.list' }, { text: 'Points', callback_data: 'points.list' }],
            ] : [[{ text: 'Register', callback_data: 'register' }]]
        }
    });
}

function validateHref(str) {
    return validateString(str) && str.indexOf(':') != -1;
}
function validateString(str) {
    return str && [...str].every(l => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _/\\!()@\'"#$%^:&?*[]{}`~.,'].indexOf(l) != -1);
}
function makeid(length) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}

bot.command('status', ctx => ctx.reply('PingSpy server is OK\nVersion: ' + require('./package.json').version));
bot.command('start', ctx => mainMenu(ctx));
bot.action('mainMenu', ctx => mainMenu(ctx));

bot.command('userid', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    ctx.reply('User ID: ' + user.id);
});
bot.command('checkAdmin', async (ctx, next) => {
    let user = await getUser(ctx);
    if (!user) return next();

    const uid = +ctx.message.text.split(' ')[1] || user.id;
    if (isNaN(uid)) return next();
    const addPth = path.resolve(__dirname, 'etc', uid + '.adminAdd');
    const rmPth = path.resolve(__dirname, 'etc', uid + '.adminRm');

    const adding = fs.existsSync(addPth);
    const rming = fs.existsSync(rmPth);

    if (!user.isAdmin && uid != user.id) return next();
    if (adding && rming) return ctx.reply('Both add and remove hooks exist. There can be only one!');
    
    let adm = user.id == uid ? user : (await db.models.User.findByPk(uid));
    if (!adm) return ctx.reply('This user doesn\'t exits');

    if (adding) {
        fs.rmSync(addPth);
        if (adm.isAdmin) return ctx.reply(adm == user ? 'You\'re an admin' : 'This user is an admin');
        adm.isAdmin = true;
        adm.save();
        ctx.reply(adm == user ? `You're now an admin!` : `This user is now an admin!`);
    }
    else if (rming) {
        fs.rmSync(rmPth);
        if (!adm.isAdmin) return adm == user ? next() : ctx.reply('This user is NOT an admin');
        adm.isAdmin = false;
        adm.save();
        ctx.reply(adm == user ? `You're NOT an admin anymore` : `This user is NOT an admin anymore`);
    }
    else {
        if (adm.isAdmin) ctx.reply(adm == user ? `You're an admin` : `This user is an admin`);
        else adm == user ? next() : ctx.reply('This user is NOT an admin');
    }
});
bot.command('admins', async (ctx, next) => {
    let user = await getUser(ctx, true);
    if (!user) return next();
    textAction(user);

    let list = (await db.models.User.findAll({ where: { isAdmin: true }, order: [['id', 'ASC']] })).map(u => u.id);
    ctx.reply(`All admins (${list.length}):\n\n${list.join('\n')}`);
});
bot.command('points_setDefault', async (ctx, next) => {
    let user = await getUser(ctx, true);
    if (!user) return next();
    textAction(user);

    let id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Please specify point ID');
    let pnt = await db.models.Point.findOne({ where: { id: id } });
    if (!pnt) return ctx.reply('This point does not exist');
    if (pnt.isDefault) return ctx.reply('This point is already default');
    pnt.isDefault = true;
    let currentDefPnt = await db.models.Point.findOne({ where: { isDefault: true } });
    if (currentDefPnt) {
        currentDefPnt.isDefault = false;
        await currentDefPnt.save();
    }
    pnt.save();
    ctx.reply('Set');
});

bot.action('register', async ctx => {
    if (await getUser(ctx)) return mainMenu(ctx);

    let user = db.models.User.build({
        telegram: ctx.chat.id
    });
    await user.save();
    await ctx.reply('You have successfully registered!');
    mainMenu(ctx);
});

bot.action('monitors.list', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    let monitors = await db.models.Monitor.findAll({ where: { owner: user.id } });
    ctx.reply('Choose a monitor to manage', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'MM', callback_data: 'mainMenu' }],
                [{ text: 'Add new', callback_data: 'monitors.new' }],
                ...monitors.sort((a, b) => a.description.localeCompare(b.description)).map(m => [{ text: (m.status == 'up' ? '🟢' : '🔴') + m.description, callback_data: 'monitors.manage:' + m.id }])
            ]
        }
    });
});
bot.action('monitors.new', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    user.telegramTextAction = 'monitors.new';
    user.save();
    ctx.reply('To create a monitor, specify the following data (one field - one line)\n\nDescription\nPoint ID (leave blank to use default one)\nHref', {
        reply_markup: {
            inline_keyboard: [[mm]]
        }
    });
});
bot.action(/^monitors\.manage:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);

    ctx.reply(`Monitor "${mon.description}" (ID: ${mon.id})`
    + `\n${mon.enabled ? 'Enabled' : 'Disabled'}`
    + `\nNotifying: ${mon.notify ? 'Yes' : 'No'}`
    + `\nPoint: ${mon.point || 'Default'}`
    + `\nHref: "${mon.href}"`
    + `\nStatus: ${mon.status == 'up' ? '🟢' : '🔴'} ${mon.status.toUpperCase()}`, {
        reply_markup: {
            inline_keyboard: [
                [mm, { text: 'Back to list', callback_data: 'monitors.list' }],
                [{ text: mon.enabled ? 'Disable' + (mon.status == 'up' ? ' (this will DOWN the monitor)' : '') : 'Enable', callback_data: 'monitors.switchEnabled:' + mon.id }],
                [{ text: (mon.notify ? 'Disable' : 'Enable') + ' notifications', callback_data: 'monitors.switchNotify:' + mon.id }],
                [{ text: 'Change description', callback_data: 'monitors.setDescription:' + mon.id }],
                [{ text: 'Change href', callback_data: 'monitors.setHref:' + mon.id }],
                [{ text: 'Change point', callback_data: 'monitors.setPoint:' + mon.id }],
                [{ text: 'Remove', callback_data: 'monitors.destroy:' + mon.id }]
            ]
        }
    });
});
bot.action(/^monitors\.setDescription:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);
    user.telegramTextAction = `monitors.setDescription:${mon.id}`;
    await user.save();

    ctx.reply(`Please specify new description for monitor "${mon.description}":`, {
        reply_markup: {
            inline_keyboard: [
                [mm, { text: 'Back to list', callback_data: 'monitors.list' }]
            ]
        }
    });
});
bot.action(/^monitors\.switchNotify:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);

    mon.notify = !mon.notify;
    await mon.save();
    ctx.reply(mon.notify ? 'Bot will now notify you if monitor status changes' : 'Bot will not notify you if monitor status changes');
});
bot.action(/^monitors\.setHref:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);
    user.telegramTextAction = `monitors.setHref:${mon.id}`;
    await user.save();

    ctx.reply(`Please specify new href for monitor "${mon.description}":`, {
        reply_markup: {
            inline_keyboard: [
                [mm, { text: 'Back to list', callback_data: 'monitors.list' }]
            ]
        }
    });
});
bot.action(/^monitors\.setPoint:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);
    user.telegramTextAction = `monitors.setPoint:${mon.id}`;
    await user.save();

    ctx.reply(`Please specify new point ID for monitor "${mon.description}" (or type "default" to link it to the default one):`, {
        reply_markup: {
            inline_keyboard: [
                [mm, { text: 'Back to list', callback_data: 'monitors.list' }]
            ]
        }
    });
});

bot.action(/^monitors\.switchEnabled:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);

    mon.enabled = !mon.enabled;
    await mon.save();
    ctx.reply(`Monitor "${mon.description}" has been ${mon.enabled ? 'enabled' : 'disabled'}`, {
        reply_markup: {
            inline_keyboard: [[mm, { text: 'Back to list', callback_data: 'monitors.list' }]]
        }
    });
});
bot.action(/^monitors\.destroy:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    const mid = ctx.callbackQuery.data.split(':')[1];
    let mon = await db.models.Monitor.findOne({
        where: {
            id: mid,
            owner: user.id
        }
    });
    if (!mon) return mainMenu(ctx);
    mon.destroy();
    ctx.reply(`Monitor "${mon.description}" has been removed`, {
        reply_markup: {
            inline_keyboard: [[mm, { text: 'Back to list', callback_data: 'monitors.list' }]]
        }
    });
});

bot.action('points.list', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    let points = await db.models.Point.findAll({ where: { owner: user.id } });
    ctx.reply('Choose a monitor to manage', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'MM', callback_data: 'mainMenu' }],
                [{ text: 'Add new', callback_data: 'points.new' }],
                ...points.map(m => [{ text: (m.status == 'up' ? '🟢' : '🔴') + '#' + m.id, callback_data: 'points.manage:' + m.id }])
            ]
        }
    });
});

bot.action('points.new', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);

    let token = makeid(32);
    let point = db.models.Point.build({
        owner: user.id,
        enabled: true,
        isDefault: false,
        tokenHash: cryptoJs.SHA512(token).toString(),
        announcedAt: new Date(0)
    });
    await point.save();
    ctx.reply(`New point (ID: ${point.id}) created\nToken: ${token}`, { reply_markup: { inline_keyboard: [[mm]] } });
});

bot.action(/^points\.manage:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);
    let id = ctx.callbackQuery.data.split(':')[1];
    let pnt = await db.models.Point.findOne({ where: { id: id, owner: user.id } });
    if (!pnt) return mainMenu(ctx);

    let adt = Math.floor((new Date - pnt.announcedAt) / 1000 / 60);
    ctx.reply(`Point #${pnt.id}${pnt.isDefault ? '\n⚠️ Is default point' : ''}`
    + `\n\n${pnt.enabled ? 'Enabled' : 'Disabled'}`
    + `\nNotifying: ${pnt.notify ? 'Yes' : 'No'}`
    + `\n${pnt.status == 'up' ? '🟢' : '🔴'} ${pnt.status.toUpperCase()}`
    + `\nVersion: ${pnt.version || 'unknown'}\nLast announce: ${adt} m ago`, {
        reply_markup: {
            inline_keyboard: [
                [ mm, { text: 'Back to list', callback_data: 'points.list' } ],
                [ { text: pnt.enabled ? (pnt.status == 'up' ? 'Stop and disable' : 'Disable') : 'Enable', callback_data: `points.switchEnabled:${pnt.id}` } ],
                [ { text: (pnt.notify ? 'Disable' : 'Enable') + ' notifications', callback_data: `points.switchNotify:${pnt.id}` } ],
                [ { text: 'Reset token', callback_data: `points.resetToken:${pnt.id}` } ]
            ]
        }
    });
});

bot.action(/^points\.switchEnabled:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);
    let id = ctx.callbackQuery.data.split(':')[1];
    let pnt = await db.models.Point.findOne({ where: { id: id, owner: user.id } });
    if (!pnt) return mainMenu(ctx);

    pnt.enabled = !pnt.enabled;
    await pnt.save();
    ctx.reply(`Point has been ${pnt.enabled ? 'enabled' : 'disabled'}`, {
        reply_markup: {
            inline_keyboard: [
                [ mm, { text: 'Back to list', callback_data: 'points.list' } ]
            ]
        }
    });
});

bot.action(/^points\.switchNotify:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);
    let id = ctx.callbackQuery.data.split(':')[1];
    let pnt = await db.models.Point.findOne({ where: { id: id, owner: user.id } });
    if (!pnt) return mainMenu(ctx);

    pnt.notify = !pnt.notify;
    await pnt.save();
    ctx.reply(pnt.notify ? 'Bot will now notify you if point status changes' : 'Bot will not notify you if point status changes');
});

bot.action(/^points\.resetToken:./g, async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    textAction(user);
    let id = ctx.callbackQuery.data.split(':')[1];
    let pnt = await db.models.Point.findOne({ where: { id: id, owner: user.id } });
    if (!pnt) return mainMenu(ctx);

    let token = makeid(32);
    pnt.tokenHash = cryptoJs.SHA512(token).toString();
    await pnt.save();
    ctx.reply(`New token:\n${token}`, {
        reply_markup: {
            inline_keyboard: [
                [ mm, { text: 'Back to list', callback_data: 'points.list' } ]
            ]
        }
    });
});

bot.on('message', async ctx => {
    let user = await getUser(ctx);
    if (!user) return mainMenu(ctx);
    let act = textAction(user);
    if (!act) return mainMenu(ctx);

    if (act.startsWith('monitors.setDescription:')) {
        const mid = act.split(':')[1];
        let mon = await db.models.Monitor.findOne({
            where: {
                id: mid,
                owner: user.id
            }
        });
        if (!mon) return mainMenu(ctx);
        let valid = validateString(ctx.message.text);
        if (valid) {
            mon.description = ctx.message.text;
            await mon.save();
        }
        ctx.reply(valid ? 'Description set' : 'Invalid description provided, try again', { reply_markup: { inline_keyboard: [[mm, { text: 'Back to list', callback_data: 'monitors.list' }]] } });
    }
    else if (act.startsWith('monitors.setHref:')) {
        const mid = act.split(':')[1];
        let mon = await db.models.Monitor.findOne({
            where: {
                id: mid,
                owner: user.id
            }
        });
        if (!mon) return mainMenu(ctx);
        let valid = validateHref(ctx.message.text);
        if (valid) {
            mon.href = ctx.message.text;
            await mon.save();
        }
        ctx.reply(valid ? 'Href set' : 'Invalid href provided, try again', { reply_markup: { inline_keyboard: [[mm, { text: 'Back to list', callback_data: 'monitors.list' }]] } });
    }
    else if (act.startsWith('monitors.setPoint:')) {
        const mid = act.split(':')[1];
        let mon = await db.models.Monitor.findOne({
            where: {
                id: mid,
                owner: user.id
            }
        });
        if (!mon) return mainMenu(ctx);

        let answer = '';
        if (ctx.message.text.toLowerCase() == 'default') {
            if (mon.point === null) answer = 'Monitor\'s point is already default';
            else {
                let pnt = await db.models.Point.findOne({
                    where: {
                        isDefault: true
                    }
                });
                if (pnt) {
                    mon.point = null;
                    mon.status = pnt.status == 'down' ? 'pointDown' : 'unknown';
                    mon.save();
                    answer = 'Monitor\'s point has been set to the default one';
                }
                else answer = 'Default point is not set on the server, contact server\'s owner';
            }
        }
        else {
            if (mon.point === ctx.message.text) answer = 'Monitor\'s point is already set to ' + mon.point;
            else {
                let pnt = await db.models.Point.findOne({
                    where: {
                        id: ctx.message.text,
                        owner: user.id
                    }
                });
                if (pnt) {
                    mon.point = pnt.id;
                    mon.status = pnt.status == 'down' ? 'pointDown' : 'unknown';
                    mon.save();
                    answer = 'Point set to ' + pnt.id
                }
                else answer = 'Specified point doesn\'t exist or it\'s not yours';
            }
        }
        ctx.reply(answer, { reply_markup: { inline_keyboard: [[mm, { text: 'Back to list', callback_data: 'monitors.list' }]] } });
    }
    else if (act == 'monitors.new') {
        let err = null;
        if (!ctx.message.text || ctx.message.text.split('\n').length != 3) err = 'Invalid line number';
        else {
            let description = ctx.message.text.split('\n')[0];
            let pointId = ctx.message.text.split('\n')[1] || null;
            let href = ctx.message.text.split('\n')[2];
            if (!validateString(description)) err = 'Invalid description';
            else if (!validateHref(href)) err = 'Invalid href';
            else if (pointId && (await db.models.Point.count({
                where: {
                    id: pointId,
                    owner: user.id
                }
            })) == 0) err = 'No such point exists or it is not available to you';
            else {
                let mon = db.models.Monitor.build({
                    description: description,
                    href: href,
                    point: pointId,
                    owner: user.id,
                    enabled: true
                });
                await mon.save();
            }
        }
        ctx.reply(err ? err : 'Monitor created', {
            reply_markup: {
                inline_keyboard: [[mm]]
            }
        });
    }
    else mainMenu(ctx);

});

async function init() {
    await bot.launch();
    console.log('TG bot started');
}

module.exports = {
    init,
    monitorStatusChanged,
    pointStatusChanged
};