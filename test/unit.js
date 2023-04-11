const Lab = require( '@hapi/lab' ),
	lab = exports.lab = Lab.script(),
	{ expect } = require( '@hapi/code' ),
	Path = require( 'path' ),
	DbCrud = require( '../src' ),
	{ in: opIn } = require('sequelize').Op;


Error.stackTraceLimit = 3;

lab.experiment( '//__ CRUD operations', function(){
	
	const creds = {};
	
	const mod = new DbCrud( {
		// debug: true,
		dir_models: Path.join( __dirname, 'models' ),
		db_sequelize: {
			database: 'db_test',
			dialect: 'sqlite',//'mysql'|'mariadb'|'sqlite'|'postgres'|'mssql',
			user: 'demo',
			password: 'demo',
			host: 'localhost',
			pool: { max: 5, min: 0, idle: 10000 },
			// storage: ':memory:',
			storage: Path.join( __dirname, 'data/db_test.sqlite' ),
			logging: false,
		},
		auth_enabled: true,
		sync: {},// false
		model_owner: 'User',
		// model_owner_fk: 'owner_id',
		model_owner_association: {
			foreignKey: 'owner_id',
			targetKey: 'id',
		},
		models: {
			User: {
				sync: { force: true },
				roles: {
					admin: 1,
					user: { read: 'owner' }
				},
				mock: async ( model ) => {
					const users = await model.bulkCreate( [
						{ login: 'admin@domain.org', password: 'demo', roles: 'admin' },
						{ login: 'user1@domain.org', password: 'demo', roles: 'user' },
						{ login: 'user2@domain.org', password: 'demo', roles: 'user' }
					] );
					
					//__ store credentials users by role for further tests
					for( let i = 0, max = users.length; i < max; i++ ){
						let user = users[ i ];
						if( !creds[ user.roles ] ){ creds[ user.roles ] = { id: user.id, roles: user.roles };}
						if( creds.admin && creds.user ) break;
					}
					
					return model;
				}
			},
			Task: {
				sync: { force: true },
				// disabled:1,
				roles: {
					admin: 1,
					user: {
						create: 1,
						read: 'owner',
						update: {
							owner: true,
							fields: ['content'],//__ restrict update on 'content' field only
						},
						delete: 'owner',
					}
				}
			},
			Project: {
				sync: { force: true },
				roles: { admin: 1 },
				mock: async ( model ) => {
					await model.bulkCreate( [
						{ title: 'Project 1', content: 'A great project content !' }
					] )
					;
					return model;
				}
			}
		},
		onModels: function( models, Sequelize, plugin ){
			//__ good place for associations ( after all models loaded but before sync )
			models.Task.hasMany( models.Task, { as: 'children', foreignKey: 'parent' } );
		}
	} );
	
	lab.before( function(){
		return mod.initialize();
	} );
	
	lab.after( () => {
		mod.database.close();
	} );
	
	//_________ tests
	lab.test( 'getModel existing one with an existing scope should return the model.', async () => {
		const model = await mod.getModel( 'Task', 'single' );
		expect( model ).to.be.a.function();
		expect( model.rawAttributes ).to.be.an.object();
		expect( model.rawAttributes.title ).to.be.an.object();
	} );

	lab.test( 'getModel unknown one should throw an UnknownModel error.', async () => {
		try{
			mod.getModel( 'UnknowModel', 'single' );
		}catch( err ){
			expect( err.message ).to.match( /UnknownModel/i );
		}
	} );
	
	lab.test( 'getModel existing one with unknown scope should throw a SequelizeScopeError.', () => {
		try{
			mod.getModel( 'Task', 'unknow_scope' );
		}catch( err ){
			expect( err.name ).to.match( /SequelizeScopeError/i );
		}
	} );
	
	lab.test( 'Create records with insufficient roles should throw Unhautorized.', async () => {
		try{
			const users = await mod.create( 'User', {
				login: 'test@domain.org',
				password: 'demo',
				roles: 'user'
			}, { credentials: creds.user, bulk: 1 } )
			expect( users ).to.be.an.error();
		}catch( err ){
			expect( err ).to.be.an.error();
			expect( err.message ).to.match( /Unauthorized/i );
		}
	} );
	
	lab.test( 'Create records with right roles should success.', async () => {
		const options = { credentials: creds.admin, bulk: 1 };
		const tasks = await mod.create( 'Task', [
			{ title: 'Task 1' },//_ if no owner set, credentials.id will be used
			{ title: 'Task 2', owner_id: 2 }
		], options );
		expect( tasks ).to.have.length( 2 );
		//__ create 2 subtask each
		for( let task of tasks ){
			await mod.create( 'Task', [
				{ title: task.title + '.1', parent: task.id, owner_id: task.owner_id },
				{ title: task.title + '.2', parent: task.id, owner_id: task.owner_id }
			], options );
		}
	} );
	
	lab.test( 'Read records of model with options.index_by property should return an object keyed on.', async () => {
		const tasks = await mod.read( 'Task', {
			raw: true,
			credentials: creds.admin,
			scopes: 'collection',
			index_by: 'title'
		} );
		expect( tasks ).to.be.an.object();
		expect( tasks[ 'Task 1' ] ).to.be.an.object();
	} );
	
	lab.test( 'Read records of model with unhautorized roles should throw Unhautorized.', async () => {
		try{
			await mod.read( 'Project', { raw: true, credentials: creds.user, scopes: 'collection' } )
		}catch( err ){
			expect( err ).to.be.an.error();
			expect( err.message ).to.match( /Unauthorized/i );
		}
	} );
	
	lab.test( 'Read records of model with roles "owner" should return only owned ones.', async () => {
		const tasks = await mod.read( 'Task', { raw: true, credentials: creds.user, scopes: 'collection' } )
		expect( tasks ).to.have.length( 1 );
	} );
	
	lab.test( 'Update records of model with roles "owner" should udpate only owned ones.', async () => {
		const updates = {
			3: { title: 'Task 1.1 modified', content: 'Content 1.1 modified' },
			5: { title: 'Task 2.1 modified', content: 'Content 2.1 modified' }
		};
		const updated = await mod.update( 'Task', updates, { credentials: creds.user } );
		expect( updated[ 3 ] ).to.equal( 0 );
		expect( updated[ 5 ] ).to.equal( 1 );
		
		let tasks = await mod.read( 'Task', { 
			raw: true,
			credentials: creds.admin,
			scopes: 'single',
			index_by: 'id',
			where: {
				id: { [opIn]: [3, 5] }
			}
		} );
		//__ 'title' field should not been updated as is not part of roles update
		expect( tasks[5].title ).not.to.equal( updates[5].title );
		expect( tasks[5].content ).to.equal( updates[5].content );
	} );
	
	
	lab.test( 'Update records with empty record should throw an UndefinedProperties error.', async () => {
		try{
			await mod.update( 'Task', { 3: null }, { credentials: creds.user } );
		}catch( err ){
			expect( res ).to.be.an.error();
		}
	} );
	
	lab.test( 'Delete records of model with roles "owner" should delete only owned ones.', async () => {
		const res = await mod.delete( 'Task', { delete_keys: [4, 6], credentials: creds.user } );
		expect( res.del_count ).to.equal( 1 );
	} );
	
	lab.test( 'Clone record of model should return the cloned new record with properties and onAfterClone called.', async () => {
		const clone_props = { id: 'bbb', title: 'Task cloned' };
		const res = await mod.clone( 'Task', 2, { credentials: creds.user, properties: clone_props } )
		expect( res ).to.be.an.object();
		expect( res.title ).to.equal( clone_props.title );
		expect( res.content ).to.equal( 'Content cloned task.' );
	} );
} );

