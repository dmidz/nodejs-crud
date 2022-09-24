const Path = require( 'path' ),
	Sequelize = require( 'sequelize' ),
	isNil = require('lodash/isNil'),
	isArray = require('lodash/isArray'),
	isString = require('lodash/isString'),
	isPlainObject = require('lodash/isPlainObject'),
	isFunction = require('lodash/isFunction'),
	keyBy = require('lodash/keyBy'),
	deepMerge = require('deepmerge'),
	deepMergeOptions = { arrayMerge: (destinationArray, sourceArray, options) => sourceArray },
	merge = ( target, source ) => {
		return deepMerge( target, source, deepMergeOptions );
	}

function DbCrud( options ){

	this.options = merge( {//_ default options
		db_sequelize: null,
		sync: null,                            //_ database sync, should not be used in production
		dir_models: Path.join( __dirname, 'models'), //_ common directory from where initial imports are done, joined with model key
		models:{//__ keys paired models, should use same key as same file name as same key in Sequelize.define
			/* //__ sample
			User:{
				sync:{ force:true },            //_ model sync, should not be used in production
				roles : {                       //_ key paired obj with CRUD actions' roles
					admin:1                     //_ when a truthy value, all CRUD actions are allowed
					, user:{ read:'owner' }     //_ roles user can only do a read actions, and only its own profile
				},
				mock:function( model ){
					//...can make create or bulkCreate here
				}
			}
			, Task:{
				sync:{ force:true },
				// disabled:1,//__ can omit this model with no need commenting or deleting the whole object
				roles:{
					admin:1
					, user:'owner'              //_ shortcut for {create:'owner',read:'owner',update:'owner',delete:'owner'}
				}
			}
			*/
		},
		debug: false,                      //_ display few console logs
		auth_enabled : true,               //_ authorization control can be totally disabled
		model_owner:'User',                //_ key of the model for owners
		model_owner_fk: 'user_id',         //_ foreign key associated to owner model pk
		roles_property: 'roles',           //_ roles property on credentials
	}, options );


	if( !this.options.db_sequelize ){   throw new Error('options.db_sequelize must be set.');}
	
	this.auth_enabled = false;//__ before initialization, authorization control is disabled for initial mock operations

	this.model_owner = null;

	if( this.options.auth_enabled ){
		if( !isString( this.options.model_owner ) || !this.options.model_owner.length ){
			throw new Error('options.model_owner must be the key of the model for owners.');}
	}
	
	this.database = new Sequelize( this.options.db_sequelize );

	this.debug('...new DbCRUD', this.options );
}

Object.assign( DbCrud.prototype, {
	initialize: async function(){//__ promise
		const models = await this.importModels( this.options.models, this.options );

		if( this.options.sync ){
			let sync = merge( {}, this.options.sync );
			
			//_ insure force will work only on dbname_test and so prevent destroying prod db
			if( sync.force && process.env.NODE_ENV === 'production'){
				sync.match = /_test$/;
			}
			// this.debug('...database.sync', sync );
			// await this.database.sync( sync );
		}
		
		this.debug('...database initialized.');
		
		//__ apply authorization control then
		this.setEnableAuth( this.options.auth_enabled );

		return models;
	},
	
	getDatabase(){ return this.database;},
	
	setEnableAuth( enable ){
		this.auth_enabled = enable;
		if( this.auth_enabled ){
			this.model_owner = this.database.models[this.options.model_owner];
			if(!this.model_owner){  throw new Error(`No model for owners found with key "${this.options.model_owner}".`);}
		}
	},
	
	prepareQuery( model, action, options = {} ){
		if( !this.auth_enabled ){ return query;}
		const query = merge({ where: {} }, options );
		
		if( !options.credentials ){   throw new Error('MissingCredentials.');}
		let user_roles = options.credentials[this.options.roles_property];
		let err_msg = `Unauthorized model action "${model.name}:${action}:${user_roles}"`;
		if( !user_roles ){    throw new Error( err_msg );}
		//__ result query that can be merged on a model action options
		let roles = this.getModelRoles( model, user_roles, action );
		if( !roles ){    throw new Error( err_msg );}

		if( roles.fields ){  query.fields = roles.fields;}
		if( action !== 'create' && roles.owner ){
			query.where[this.options.model_owner_fk] = options.credentials[this.model_owner.primaryKeyField];
		}

		this.debug('...prepareQuery', { model, action, role: options.credentials[ this.options.roles_property ], query } );

		return query;
	},
	
	getModelRoles( model, role, action ){
		if(!this.options.models[model.name]){  return null;}
		let model_roles = this.options.models[model.name].roles;
		if(!model_roles){ return null;}
		if( isPlainObject( model_roles ) ){
			model_roles = model_roles[role];
			if(!model_roles){   return null;}
			if( isPlainObject( model_roles ) ){
				model_roles = model_roles[action];
				if(!model_roles){   return null;}
			}
		}
		if( isFunction( model_roles ) ){  model_roles = model_roles( role, this.database.models );}
		if( isString( model_roles ) ){    model_roles = { [model_roles]:true };}

		return model_roles;
	},
	
	create: async function( model_key, records, options ){

		options = options || {};
		this.debug('......create', model_key, options );
		if( isNil( records ) ){    throw new Error('UndefinedProperties : records must be an object or an array of objects.');}
		const is_single = !( records instanceof Array );
		if( is_single ){  records = [records];}
		
		const model = await this.getModel( model_key, options.scopes );
		const query = this.prepareQuery( model, 'create', options );

		let auto_increment = false;
		if( model.rawAttributes[ model.primaryKeyField ] ){ auto_increment = model.rawAttributes[ model.primaryKeyField ].autoIncrement;}
		
		const owner_id = this.auth_enabled ? options.credentials[ this.model_owner.primaryKeyField ] : null;
		
		for( let i = 0, max = records.length; i < max; i++ ){
			let record = records[ i ];
			
			if( auto_increment ){ delete record[ model.primaryKeyField ];}
			
			if( this.auth_enabled ){
				if( query.check ){
					query.check( record );
				}
				//__ create roles defines how can be set the owner of the records
				//__ if auth_query.owner or record owner not set : record owner will be set with credentials id
				if( query.owner || isNil( record[ this.options.model_owner_fk ] ) ){
					if( isNil( owner_id ) ){
						throw new Error( `crendentials pk "${this.model_owner.primaryKeyField}" must be set in order to set records owner.` );
					}
					record[ this.options.model_owner_fk ] = owner_id;
				}
			}
		}
		
		//___
		if( options.bulk ){
			return model.bulkCreate( records, options );
		}else{
			//__ by default, row by row insert will allow that an insert error will not fail the others
			//_ it will return an array filled with created record or an error
			const res = [];
			for( let record of records ){
				try {
					const created = await model.create( record, options );
					res.push(  created );
				}catch( err ){
					if( is_single ) throw err;
					res.push( err );
				}
			}

			return is_single ? res[ 0 ] : res;
			
		}
	},
	
	read: async function( model_key, options ){
		this.debug('......read', model_key, options );
		options = options || {};
		const is_single = !isNil( options.single_key );

		const model = this.getModel( model_key, options.scopes );
		const query = this.prepareQuery( model, 'read', options );
		
		if( is_single ){ query.where[ model.primaryKeyField ] = options.single_key;}

		let res = await model[ is_single ? 'findOne' : 'findAll' ]( query );
		if( options.index_by && !is_single ){ res = keyBy( res, options.index_by );}
		return res;

	},
	
	update: async function( model_key, records, options ){

		options = options || {};
		this.debug('......update', model_key, options );
		if( isNil( records ) ){  throw new Error('UndefinedProperties : 2nd arg records must be defined.');}

		const model = this.getModel( model_key, options.scopes );
		const query = this.prepareQuery( model, 'update', options );
		const pk = model.primaryKeyField;
		
		const res = {};
		const prs = {};
		for( let key in records ){
			let record = records[ key ];
			if( isNil( record ) ){ 
				res[ key ] = new Error( 'UndefinedProperties : record cannot be null or undefined.' );
				continue;
			}
			let opts = merge( query, { where: { [ pk ]: key }, limit: 1 } );
			this.debug( '......update record', { record, query, opts } );
			
			prs[ key ] = record;
			if( isFunction( model.onBeforeUpdate ) ){
				prs[ key ] = model.onBeforeUpdate( record, key, opts );
			}
			
			try{
				const updated = await model.update( record, opts );
				res[ key ] = updated[ 0 ];
				if( isFunction( model.onAfterUpdate ) ){
					model.onAfterUpdate( record, key, opts, res[ key ] );
				}
			}catch( err ){
				res[ key ] = err;
			}
		}

		return res;
				
	},
	
	delete: async function( model_key, options ){
		options = options || {};
		this.debug('......delete', model_key, options );

		const model = this.getModel( model_key, options.scopes );
		const query = this.prepareQuery( model, 'delete', options );
		
		let keys = [];
		if( !isNil( options.delete_keys ) ){
			keys = options.delete_keys;
			if( !isArray( keys ) ){ keys = [keys];}
			const pk = model.primaryKeyField;
			query.where[ pk ] = { [ Sequelize.Op.in ]: keys };
		}
		const del_count = await model.destroy( query );

		return { del_count };
	},

	clone: async function( model_key, src_key, options ){

		if( isNil( src_key ) ){     throw new Error('CloneMissingSrcKey : 2nd arg src_key must be defined.');}
		options = merge({}, options );
		options.single_key = src_key;

		const record_src = await this.read( model_key, options );
		if( !record_src ){    throw new Error( `CloneSrcNotFound : no record source found with the id "${src_key}"` );}

		const model = this.getModel( model_key )
		
		let record = { ...record_src.get( { plain: true } ) };
		delete record[ model.primaryKeyField ];
		delete record.createdAt;
		delete record.created_at;
		delete record.updatedAt;
		delete record.updated_at;
		if( model.beforeClone ){ model.beforeClone( record, record_src, options, this );}
		if( options.properties ){ record = merge( record, options.properties );}
		
		const created = await this.create( model_key, record, { credentials: options.credentials } );
		
		if( model.onAfterClone ){
			model.onAfterClone( created, record_src, options, this );
		}
		
		return created;
	},

	getModel( model_key, scopes ){
		let model = this.database.models[ model_key ];
		if(!model){   throw new Error(`UnknownModel '${model_key}'`);}
		if( typeof scopes !== 'undefined'){     model = model.scope( scopes );}
		this.debug('...getModel', model_key, scopes );
		return model;
	},

	getModels(){    return this.database.models;},

	importModels: async function( models, options = {} ){
		const imports = {};
		for( let key in models ){
			if( models[ key ].disabled ){ continue;}
			imports[ key ] = this.importModel( Path.join( options.dir_models || __dirname, key ) );
		}
		this.debug( '...models imported', imports );
		if( typeof this.options.onModels === 'function' ){
			this.options.onModels( imports, this.database, this );
		}
		for( let key in imports ){
			await afterImportModel( imports[ key ], models[ key ], this.options, this.database );
		}
		return imports;
	},

	importModel( path, options ){
		this.debug( '...import model', path );
		try {
			let model = require( path )( this.database, Sequelize.DataTypes );
			// if( !model ){   reject( new Error('NullImportedModel : check Class is returned in model file '+path+'.') );}
			if( options ){    return afterImportModel( model, options, this.options, this.database );}
			return model;
		}catch( err ){
			throw err;
		}
	},
	
	debug( ...args ){
		if( !this.options.debug ){  return;}
		console.log.call( null, ...args );
	},
});

async function afterImportModel ( model, modelOptions = {}, options = {}, database ){
	
	if( options.model_owner && modelOptions.roles ){
		const model_owner = database.models[options.model_owner];
		if( model !== model_owner ){
			if(!model_owner){  throw new Error(`No owner model found with key "${options.model_owner}".`);}
			const foreignKey = modelOptions.model_owner_fk || options.model_owner_fk;
			options.debug && console.log('...model.auth relation', foreignKey );
			model.belongsTo( model_owner, { foreignKey } );
		}
	}

	if( modelOptions.sync ){
		let sync = merge( {}, modelOptions.sync );
		//_ insure force will work only on dbname_test and so prevent destroying prod db
		sync.match = /_test$/;
		options.debug && console.log('...model.sync', model.name, sync );
		await model.sync( sync );
	}

	if( typeof modelOptions.mock === 'function' ){
		options.debug  && console.log('...model.mock', model.name );
		await modelOptions.mock( model );
	}

	return model;
}

module.exports = DbCrud;
