
const Promise = require('bluebird');

module.exports = function(sequelize, DataTypes) {

	const models = sequelize.models;

	const Task = sequelize.define('Task', {
		id : {          type: DataTypes.INTEGER, primaryKey: true, unique: true, autoIncrement: true },
		title: {      type: DataTypes.STRING, allowNull: false/*, defaultValue : 'New Task'*/ },
		content: {    type: DataTypes.TEXT, allowNull: true }
	},
	{
		underscored : true, freezeTableName: true,
		scopes : {
			collection( ){//__ returns only root tasks ( with no parent )
				return {
					where: { parent: null },
					attributes:['id','title','created_at']
				}
			},
			single( ){//__ include subtasks as 'children'
				return {
					attributes:['id','title','parent'],
					include:[
						{ model:models.Task.scope('task_children'), as:'children'}
					]
				}
			},
			task_children:{
				attributes:['id','user_id']
			}
		}
	});


	Object.assign( Task, {
		onAfterUpdate( record, key, options, result ){
			// console.log('....onAfterUpdate', record, key, options );
			return new Promise( function( resolve, reject ){
				//__ fake long action
				setTimeout(function(){
					// console.log('............ onAfterUpdate timeout');
					result.my_prop = 'ok';
					resolve();
				}, 500 );
			});
		},
		onAfterClone( record_dup, record_src, options ){
			// console.log('.....onAfterClone', this );
			return record_dup.update({ content: 'Content cloned task.'})
		}
	});

	return Task;
};



