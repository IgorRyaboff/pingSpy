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
                if (p.status == 'down') {
                    (await db.models.Monitor.findAll({
                        where: {
                            point: p.id,
                            status: {
                                [Sequelize.Op.ne]: 'pointDown'
                            }
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