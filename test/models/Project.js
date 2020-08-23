
module.exports = function(sequelize, DataTypes) {

	return sequelize.define('Project', {
		id : {          type: DataTypes.INTEGER, primaryKey: true, unique: true, autoIncrement: true },
		title: {      type: DataTypes.STRING, allowNull: false, defaultValue : 'New Project'},
		content: {    type: DataTypes.TEXT, allowNull: true },
	},
	{
		underscored : true, freezeTableName: true,
		scopes : {
			collection : {
				attributes:['id','title','created_at']
			},
			single( ){
				return {
					attributes:['id','title','content','created_at']
				}
			}
		}
	});

};



