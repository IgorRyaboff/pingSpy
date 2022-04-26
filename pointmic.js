const Sequelize = require('sequelize');
/** @type {Sequelize.Sequelize} */ const db = global.db;
const Express = require('express');
const cryptoJs = require('crypto-js');

let server = Express();
server.listen(require('./etc/pointmic.json').port);
server.use(Express.json({
    type: 'application/json'
}));
console.log('Pointmic started');

/**
 * 
 * @param {Express.Response} resp
 * @param {{ ok : boolean }} data
 */
function respond(resp, data = {}) {
    resp.type('json');
    resp.end(JSON.stringify(data || {}));
}

/**
 * 
 * @param {Express.Response} resp
 * @param {object} data
 */
function ok(resp, data = {}) {
    respond(resp, { ok: true, ...data });
}

/**
 * 
 * @param {Express.Response} resp
 * @param {string} code
 */
function fail(resp, code) {
    respond(resp, { ok: false, code: code });
}

server.post('/announce', async (req, resp) => {
    let point = await db.models.Point.findOne({
        where: {
            tokenHash: cryptoJs.SHA512(req.body.token).toString()
        }
    });
    if (!point) return fail(resp, 'INVALID_TOKEN');
    if (!point.enabled) return fail(resp, 'POINT_DISABLED');
    if (point.status != 'up') {
        point.status = 'up';
    }
    point.announcedAt = new Date;
    await point.save();

    if (!req.body.data) return fail(resp, 'NO_DATA_ARG');

    let remove = [];
    let newMonitorsObj = {};
    for (let i in req.body.data) {
        //console.log('doing', i);
        if (!req.body.data[i]) {
            remove.push(i);
            //console.log('!data[i]');
            continue;
        }
        const receivedStatus = req.body.data[i].status;
        const receivedHref = req.body.data[i].href;
        if (!receivedHref || ['up', 'down'].indexOf(receivedStatus) == -1) {
            //console.log(`!!!`, receivedHref, receivedStatus);
            continue;
        }

        let monitor = await db.models.Monitor.findByPk(i);
        if (!monitor) {
            remove.push(i);
            //console.log('!monitor');
            continue;
        }
        if (!point.isDefault && point.owner != monitor.owner) {
            remove.push(i);
            //console.log('mon attached to foreign point');
            continue;
        }
        if (monitor.point != point.id && !(!monitor.point && point.isDefault)) {
            remove.push(i);
            //console.log('removing');
            continue;
        }
        if (!monitor.enabled) {
            remove.push(i);
            //console.log('!monitor.enabled');
            continue;
        }
        if (monitor.href != receivedHref) {
            newMonitorsObj[i] = {
                href: monitor.href,
                status: monitor.status
            };
            //console.log('!href');
            continue; // We don't receive this status because this measurement was done with outdated or invalid href
        }
        if (monitor.status != receivedStatus) {
            monitor.status = receivedStatus;
            await monitor.save();
            //console.log('saved');
        }
        //else console.log('status unchanged');
    }

    let andPart = [
        {
            id: {
                [Sequelize.Op.notIn]: Object.keys(req.body.data)
            }
        }
    ];
    if (point.isDefault) andPart.push({
        [Sequelize.Op.or]: [
            { point: point.id },
            { point: null }
        ]
    });
    else andPart.push({ point: point.id });
    let newMonitors = await db.models.Monitor.findAll({ where: {
        [Sequelize.Op.and]: andPart,
        enabled: true
    }});
    newMonitors.forEach(m => {
        newMonitorsObj[m.id] = {
            status: m.status,
            href: m.href
        };
    });

    ok(resp, {
        me: point.id,
        remove: remove,
        new: newMonitorsObj
    });
});

async function processFallenPoints() {
    let fallenPoints = await db.models.Point.findAll({
        where: {
            status: 'up',
            [Sequelize.Op.and]: [
                { announcedAt: { [Sequelize.Op.ne]: null } },
                { announcedAt: { [Sequelize.Op.lt]: new Date(+new Date - 1000 * 60 * 3) } }
            ]
        }
    });
    for (let i = 0; i < fallenPoints.length; i++) {
        let p = fallenPoints[i];
        p.status = 'down';
        await p.save();
    }
}
setInterval(() => processFallenPoints(), 30000);
processFallenPoints();