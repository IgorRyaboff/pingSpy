const Sequelize = require('sequelize');
/** @type {Sequelize.Sequelize} */ const db = global.db;
const tg = require('./tgbot');

module.exports = (async () => {
    db.define('Monitor', {
        id: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        point: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED
        },
        description: {
            type: Sequelize.DataTypes.STRING,
            allowNull: false
        },
        href: {
            type: Sequelize.DataTypes.STRING,
            allowNull: false
        },
        owner: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        enabled: {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            set(value) {
                this.setDataValue('enabled', value);
                this.status = value ? 'unknown' : 'down';
            }
        },
        status: {
            type: Sequelize.DataTypes.ENUM(['up', 'down', 'pointDown', 'noDefaultPoint', 'unknown']),
            defaultValue: 'unknown',
            allowNull: false
        }
    }, {
        tableName: 'monitors',
        timestamps: true,
        updatedAt: false,
        hooks: {
            afterUpdate(m) {
                if (m.isNewRecord || !m.previous('status') || m.status == m.previous('status')) return;
                tg.monitorStatusChanged(m, m.previous('status'));
                console.log(`Monitor ${m.id} status changed from ${String(m.previous('status')).toUpperCase()} to ${m.status.toUpperCase()}`);
            }
        },
        paranoid: true
    });

    db.define('Point', {
        id: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        owner: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED
        },
        enabled: {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            set(value) {
                this.setDataValue('enabled', value);
                this.status = value ? 'unknown' : 'down';
            }
        },
        tokenHash: {
            type: Sequelize.DataTypes.STRING,
            allowNull: false
        },
        isDefault: {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false
        },
        status: {
            type: Sequelize.DataTypes.ENUM(['up', 'down', 'unknown']),
            defaultValue: 'unknown',
            allowNull: false
        },
        version: {
            type: Sequelize.DataTypes.STRING
        },
        announcedAt: {
            type: Sequelize.DataTypes.DATE
        }
    }, {
        tableName: 'points',
        timestamps: true,
        updatedAt: false,
        hooks: {
            async afterSave(p) {
                if (p.isNewRecord || !p.previous('status') || p.status == p.previous('status')) return;
                tg.pointStatusChanged(p, p.previous('status'));
                console.log(`Point ${p.id} status changed from ${String(p.previous('status')).toUpperCase()} to ${p.status.toUpperCase()}`);
                if (p.status == 'down') {
                    (await db.models.Monitor.findAll({
                        where: {
                            [Sequelize.Op.and]: [
                                { status: { [Sequelize.Op.ne]: 'pointDown' } },
                                { [Sequelize.Op.or]: p.isDefault ? [ { point: p.id }, { point: null } ] : [ { point: p.id } ] }
                            ]
                        }
                    })).forEach(m => {
                        m.status = 'pointDown';
                        m.save();
                    });
                }
            }
        },
        paranoid: true
    });

    db.define('User', {
        id: {
            type: Sequelize.DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        telegram: {
            type: Sequelize.DataTypes.BIGINT
        },
        telegramTextAction: {
            type: Sequelize.DataTypes.STRING
        },
        isAdmin: {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        }
    }, {
        tableName: 'users',
        timestamps: true,
        updatedAt: false,
        paranoid: true
    });

    await db.sync({ alter: true });
})();