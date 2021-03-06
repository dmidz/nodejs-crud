
const bcrypt = require('bcrypt');

module.exports = function(sequelize, DataTypes) {

	const salt = bcrypt.genSaltSync( 8 );

	return sequelize.define('User', {
		id : {          type : DataTypes.INTEGER, primaryKey: true, unique: true, autoIncrement: true },
		login: {      type: DataTypes.STRING, allowNull: false },
		password: {   type: DataTypes.STRING, allowNull: false,
			set( value ){
				this.setDataValue('password', bcrypt.hashSync( value, salt ));
			}
		},
		roles: {      type: DataTypes.STRING, allowNull: true }
	},
	{
		underscored : true,
		freezeTableName: true,// Model tableName will be the same as the model name
		indexes:[
			{ unique:true, fields:['login'] }
		],
		scopes : {
			single : function( ){
				return {
					attributes:['id','login','password','roles']
					// , include:[{
					// 	model:models.Task.scope({method:['user_tasks']})
					// 	, as:'tasks'
					// }]
				};
			}
		}

	});

};



