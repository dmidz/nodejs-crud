
const Lab = require('@hapi/lab'),
	lab = exports.lab = Lab.script(),
	{ expect } = require('@hapi/code'),
	Path = require('path'),
	Promise = require('bluebird'),
	DbCrud = require('../src')
;

Error.stackTraceLimit = 3;

lab.experiment('//__ CRUD operations', function(){

	const creds = {};

	const mod = new DbCrud({
		debug: true //require.main === module
		, dir_models : Path.join( __dirname, 'models' )
		, db_sequelize : {
			database : 'db_test'
			, operatorsAliases:false
			, dialect: 'sqlite'//'mysql'|'mariadb'|'sqlite'|'postgres'|'mssql',
			, user: 'demo'
			, password: 'demo'
			, host: 'localhost'
			, pool: { max: 5, min: 0, idle: 10000 }
			, storage : ':memory:'// Path.join( __dirname, 'data/db_test.sqlite' )
			// , logging: console.log// false
		}
		, auth_enabled:true
		// , sync:{ /*force:true */}
		, model_owner:'User'
		, model_owner_fk: 'owner_id'
		, models: {
			User:{
				sync:{ force:true },
				roles : {
					admin:1
					, user:{
						read:'owner'
					}
				},
				mock:function( model ){
					return model.bulkCreate([
						{ login:'admin@domain.org'
							, password: 'demo'
							, roles: 'admin'
						}
						,{ login:'user1@domain.org'
							, password: 'demo'
							, roles: 'user'
						}
						,{ login:'user2@domain.org'
							, password: 'demo'
							, roles: 'user'
						}
					] )
						.then(function( users ){
							//__ store creds users by role for further tests
							for(let i = 0, max = users.length; i < max; i++){
								let user = users[i];
								if(!creds[user.roles])  creds[user.roles] = {
									id:user.id,
									roles:user.roles
								};
								if(creds.admin && creds.user )  break;
							}
							return model;
						})
						;
				}
			}
			, Task:{
				sync:{ force:true },
				// disabled:1,
				roles:{
					admin:1
					, user:'owner'
				}
			}
			, Project:{
				sync:{ force:true },
				roles : {
					admin:1
					// , user:{ read:'owner'}//_ unhautorized
				},
				mock:function( model ){
					return model.bulkCreate([
						{ title:'Project 1', content: 'A great project content !' }
					] )
						;
				}
			}
		}
		, onModels : function( models, Sequelize, plugin ){
			//__ good place for associations ( after all models loaded but before sync )
			models.Task.hasMany( models.Task, { as: 'children', foreignKey: 'parent' } );
			if( models.User ){
				models.Task.belongsTo( models.User, {foreignKey: 'owner_id'} );
				models.User.hasMany( models.Task, {foreignKey: 'owner_id', as:'tasks' } );
			}
		}
	});

	lab.before( function(){
		return mod.initialize();
	});

	//_________ tests
	lab.test('getModel existent one with an existant scope should return the model.', function( ){
		return mod.getModel('Task', 'single' )
		.then(function( model ) {
			expect( model ).to.be.a.function();
			expect( model.attributes ).to.be.an.object();
			expect( model.attributes.title ).to.be.an.object();
		})
		;
	});

	lab.test('getModel unknown one should throw an UnknownModel error.', function( ){
		return mod.getModel('UnknowModel', 'single' )
		.catch(function( err ) {
			expect( err.message).to.match(/UnknownModel/i);
		})
		;
	});

	lab.test('getModel existent one with unknown scope should thow a SequelizeScopeError error.', function( ){
		return mod.getModel('Task', 'unknow_scope' )
		.catch(function( err ) {
			expect( err.name ).to.match(/SequelizeScopeError/i);
		})
		;
	});

	lab.test('Create records with insufficient roles shoud throw Unhautorized.', function( ){
		return mod.create('User', { login:'test@domain.org'
			, password:'$2a$10$7g04N01EzmbfXS0QwXuuBuNa8ReUy9Ih2fhXn2ic0hRNWkTSXmS6C'// "demo"
			, roles: 'user'
		}, { credentials:creds.user, bulk:1 } )
		.then(function( users ) {
			expect( users ).to.be.an.error();
		})
		.catch(function( err ) {
			expect( err ).to.be.an.error();
			expect( err.message).to.match(/Unauthorized/i);
		})
		;
	});

	lab.test('Create records with right roles should success.', function( ){
		const options = { credentials:creds.admin, bulk:1 };
		return mod.create('Task', [
			{ title: 'Task 1'/*, owner_id:1*/ },//_ if no owner set, creds.id will be used
			{ title: 'Task 2', owner_id:2 }
		], options )
		.then(function( tasks ) {
			// console.log('# res', tasks );
			expect( tasks ).to.have.length( 2 );
			//__ create 2 subtask each
			return Promise.map( tasks, function( task ) {
				return mod.create('Task', [
					{ title: task.title+'.1', parent:task.id, owner_id:task.owner_id },
					{ title: task.title+'.2', parent:task.id, owner_id:task.owner_id }
				], options );
			});
		});
	});

	lab.test('Read records of model with options.index_by property should return an object keyed on.', function( ){
		return mod.read('Task', { raw:true, credentials:creds.admin, scopes:'collection', index_by:'title' } )
		.then(function( tasks ) {
			// console.log('---- res ordered', tasks );
			expect( tasks ).to.be.an.object();
			expect( tasks['Task 1'] ).to.be.an.object();
		})
		;
	});

	lab.test('Read records of model with unhautorized user roles should throw Unhautorized.', function( ){
		return mod.read('Project', { raw:true, credentials:creds.user, scopes:'collection' } )
		.then(function( projects ) {
			expect( projects ).to.be.an.error();
		})
		.catch(function( err ) {
			expect( err ).to.be.an.error();
			expect( err.message).to.match(/Unauthorized/i);
		})
		;
	});

	lab.test('Read records of model with roles "owner" should return only owned ones.', function( ){
		return mod.read('Task', { raw:true, credentials:creds.user, scopes:'collection' } )
		.then(function( res ) {
			console.log('### res :', res );
			expect( res ).to.have.length( 1 );
		})
		;
	});

	lab.test('Update records of model with roles "owner" should udpate only owned ones.', function( ){
		return mod.update('Task'
			, {3:{ title:'Task 1.1 modified bis' }
				, 5:{ title:'Task 2.1 modified bis' } }
			, { credentials:creds.user/*, scopes:'update'*/ } )
		.then(function( res ) {
			console.log('### res :', res );
			expect( res[3].result ).to.equal(0);
			expect( res[5].result ).to.equal(1);
		})
		;
	});

	lab.test('Update records with empty record should throw an UndefinedProperties error.', function( ){
		return mod.update('Task', {3:null }, { credentials:creds.user/*, scopes:'update'*/ }
		)
		.catch(function( res ) {
			console.log('### res :', res );
			expect( res ).to.be.an.error();
		})
		;
	});

	lab.test('Delete records of model with roles "owner" should delete only owned ones.', function( ){
		return mod.delete('Task'
			, { delete_keys:[ 4, 6 ], credentials:creds.user } )
		.then(function( res ) {
			console.log('### res :', res );
			expect( res.del_count ).to.equal(1);
		})
		;
	});

	lab.test('Clone record of model should return the cloned new record with properties and onAfterClone called.', function( ){
		const clone_props = { id:'bbb', title:'Task cloned'};
		return mod.clone('Task', 2, { credentials:creds.user, properties:clone_props } )
		.then(function( res ) {
			console.log('### res :', res.get() );
			expect( res ).to.be.an.object();
			expect( res.title ).to.equal( clone_props.title );
			expect( res.content ).to.equal( 'Content cloned taskZ.' );
		})
		;
	});
});

