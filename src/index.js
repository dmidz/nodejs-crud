const Path = require( 'path' ),
	Promise = require( 'bluebird' ),
	Sequelize = require( 'sequelize' ),
	isNil = require('lodash/isNil'),
	isArray = require('lodash/isArray'),
	isString = require('lodash/isString'),
	isObject = require('lodash/isObject'),
	isFunction = require('lodash/isFunction'),
	mergeWith = require('lodash/mergeWith'),
	keyBy = require('lodash/keyBy'),
	replaceIfArray = ( to, from ) => (isArray( to ) ? from : undefined),
	merge = ( ...args ) => mergeWith( ...args, replaceIfArray )
	;


function DbCrud( options ){
	const me = this;

	me.options = merge( {//_ default options
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


	if( !me.options.db_sequelize ){   throw new Error('options.db_sequelize must be set.');}
	
	me.auth_enabled = false;//__ before initialization, authorization control is disabled for intial mock operations

	me.model_owner = null;

	if( me.options.auth_enabled ){
		if( !isString( this.options.model_owner ) || !this.options.model_owner.length ){
			throw new Error('options.model_owner must be the key of the model for owners.');}
	}
	
	me.database = new Sequelize( me.options.db_sequelize );

	if( me.options.debug ){   console.log('...new DbCRUD', me.options );}
}

Object.assign( DbCrud.prototype, {
	initialize(){//__ promise
		const me = this;
		return me.importModels( me.options.models, me.options )
		.then( function( models ){
			if( me.options.sync ){
				let sync = merge( {}, me.options.sync );
				//_ insure force will work only on dbname_test and so prevent destroying prod db
				if( sync.force && process.env.NODE_ENV === 'production'){   sync.match = /_test$/;}
				if(me.options.debug){   console.log('...database.sync');}
				return me.database.sync( sync );
			}
			return models;
		} )
		.then( function(){
			if(me.options.debug){   console.log('...database initialized.');}
			//__ apply authorization control then
			me.setEnableAuth( me.options.auth_enabled );
			return null;
		} )
		;
	},
	getDatabase(){ return this.database;},
	setEnableAuth( enable ){
		this.auth_enabled = enable;
		if( this.auth_enabled ){
			this.model_owner = this.database.models[this.options.model_owner];
			if(!this.model_owner){  throw new Error('No model for owners found with key "'+this.options.model_owner+'".');}
		}
	},
	checkAuth( model_key, action, credentials ){
		if( !credentials ){   throw new Error('MissingCredentials.');}
		let user_roles = credentials[this.options.roles_property];
		let err_msg = 'Unauthorized model action "'+model_key+':'+action+':'+user_roles+'"';
		if( !user_roles ){    return Promise.reject( new Error( err_msg ) );}
		//__ result query that can be merged on a model action options
		let query_auth = this.getModelRoles( model_key, action, credentials );
		if(!query_auth){    return Promise.reject( new Error( err_msg ) );}

		if( action !== 'create' && query_auth.owner ){
			merge( query_auth, {
				where:{
					[this.options.model_owner_fk] : credentials[this.model_owner.primaryKeyField]
				}
			});
		}

		if(this.options.debug){
			console.log('...checkAuth', model_key, action, credentials[this.options.roles_property], query_auth );}

		return Promise.resolve( query_auth );
	},
	getModelRoles( model_key, action, credentials ){
		if(!this.options.models[model_key]){  return null;}
		let model_roles = this.options.models[model_key].roles;
		if(!model_roles){ return null;}
		if( isObject( model_roles ) ){
			if(!credentials || !credentials[this.options.roles_property] ){   return null;}
			model_roles = model_roles[credentials[this.options.roles_property]];
			if(!model_roles){   return null;}
			if( isObject( model_roles ) ){
				model_roles = model_roles[action];
				if(!model_roles){   return null;}
			}
		}
		if( isFunction( model_roles ) ){  model_roles = model_roles( credentials, this.database.models );}
		if( isString( model_roles ) ){    model_roles = { [model_roles]:true };}

		return model_roles;
	},
	create( model_key, records, options ){
		const me = this;
		options = options || {};
		if( me.options.debug ){   console.log('......create', model_key, options );}
		if( isNil( records ) ){    return Promise.reject(new Error('UndefinedProperties : records must be an object or an array of objects.'));}
		const is_single = !( records instanceof Array );
		if( is_single ){  records = [records];}

		return Promise.join( me.getModel( model_key, options.scopes ),
			me.auth_enabled ? me.checkAuth( model_key, 'create', options.credentials ) : null,
			function( model, auth_query ){

				let auto_increment = false;
				if( model.attributes[model.primaryKeyField] ){    auto_increment = model.attributes[model.primaryKeyField].autoIncrement;}

				let owner_id = auth_query ? options.credentials[me.model_owner.primaryKeyField] : null;

				for(let i = 0, max = records.length; i < max; i++){
					let record = records[i];

					if( auto_increment ){   delete record[model.primaryKeyField];}

					if( auth_query ){
						if( auth_query.check ){
							const check = auth_query.check( record );
							if( check ){
								if( check.then ){                   pr = check;}
								else if( check instanceof Error ){  pr = Promise.reject( check );}
							}
						}
						//__ create roles defines how can be set the owner of the records
						//__ if auth_query.owner or record owner not set : record owner will be set with credentials id
						if( auth_query.owner || isNil( record[me.options.model_owner_fk] ) ){
							if( isNil( owner_id ) ){
								return Promise.reject( new Error('crendentials pk "'+me.model_owner.primaryKeyField+'" must be set in order to set records owner.'));}
							record[me.options.model_owner_fk] = owner_id;
						}
					}
				}

				//___
				if( options.bulk ){   return model.bulkCreate( records, options );}
				else{
					//__ by default, row by row insert will allow that an insert error will not fail the others
					//_ it will return an array filled with created record or an error
					const res = [];
					return Promise.map( records, function( record, index ){
						return model.create( record, options )
						.then(function( created ){ res[index] = created;})
						.catch(function( err ){
							if( is_single ) throw err;
							res[index] = err;
						});
					})
					.then( function(){
						return is_single ? res[0] : res;
					})
					;
				}
			}
		);
	},
	read( model_key, options ){
		const me = this;
		if(me.options.debug){   console.log('......read', model_key, options );}
		options = options || {};
		const is_single = !isNil( options.single_key );
		return Promise.join( me.getModel( model_key, options.scopes ),
			me.auth_enabled ? me.checkAuth( model_key, 'read', options.credentials ) : null,
			function( model, auth_query ){
				const opts = merge( { where:{} }, options );
				if( is_single ){    opts.where[model.primaryKeyField] = options.single_key;}
				if( auth_query ){   merge( opts, auth_query );}
				return model[is_single?'findOne':'findAll']( opts );
			}
		)
		.then(function( res ){
			if( options.index_by && !is_single ){   res = keyBy( res, options.index_by );}
			return res;
		})
		;
	},
	update( model_key, records, options ){
		const me = this;
		options = options || {};
		if( me.options.debug ){   console.log('......update', model_key, options );}
		if( isNil( records ) ){  return Promise.reject(new Error('UndefinedProperties : 2nd arg records must be defined.'));}
		// if(!(records instanceof Array ))    records = [records];

		return Promise.join( me.getModel( model_key, options.scopes ),
			me.auth_enabled ? me.checkAuth( model_key, 'update', options.credentials ) : null,
			function( model, auth_query ){
				//___ TODO : no bulk for update
				// const is_single = check( options.single_key );
				// if( is_single )     records = { [model.primaryKeyField]:records };

				const res = {};
				const pk = model.primaryKeyField;
				const prs = {};
				for(let key in records ){
					let record = records[key];
					if( isNil( record ) ){   return Promise.reject(new Error('UndefinedProperties : record cannot be null or undefined.'));}
					const opts = merge( { where:{ [pk]:key } }, options );
					if( auth_query ){   merge( opts, auth_query );}
					opts.limit = 1;
					if( me.options.debug ){   console.log('......update record', record, opts );}


					prs[key] = Promise.resolve( record );
					if( isFunction( model.onBeforeUpdate ) ){   prs[key] = model.onBeforeUpdate( record, key, opts );}

					prs[key] = prs[key]
					.then( function( record ){
						return model.update( record, opts );
					})
					.then(function( upd_res ){
						// console.log('### upd_res', upd_res[0] );
						res[key] = { result: upd_res[0] };

						if( isFunction( model.onAfterUpdate ) ){
							// console.log('....on updateOne B', res_upd );
							return model.onAfterUpdate( record, key, opts, res[key] );
						}

						return res[key];
					})
					.catch(function( err ){     res[key] = err;})
				}

				return Promise.props( prs )
				.then(function(){
					return res;
				});

			}
		);
	},
	delete( model_key, options ){
		const me = this;
		options = options || {};
		if( me.options.debug ){   console.log('......delete', model_key, options );}

		return Promise.join( me.getModel( model_key ),
			me.auth_enabled ? me.checkAuth( model_key, 'update', options.credentials ) : null,
			function( model, auth_query ){
				let keys = [];
				const opts = merge( { where:{} }, options );
				if( !isNil( options.delete_keys ) ){
					keys = options.delete_keys;
					if( !isArray( keys ) ){   keys = [keys];}
					const pk = model.primaryKeyField;
					opts.where[pk] = {[Sequelize.Op.in]:keys};
				}
				if( auth_query ){     merge( opts, auth_query );}
				return model.destroy( opts )
				.then( function( del_count ){
					return { del_count };
				});
			}
		);
	},
	clone( model_key, src_key, options ){
		const me = this;
		let model = null;
		let record_src = null;
		if( isNil( src_key ) ){     throw new Error('CloneMissingSrcKey : 2nd arg src_key must be defined.');}
		options = merge({}, options );
		options.single_key = src_key;

		return Promise.join(
			me.read( model_key, options ),
			me.getModel( model_key )
		)
		.then( function( joined ){
			record_src = joined[ 0 ];
			model = joined[ 1 ];
			if( !record_src ){    throw new Error( 'CloneSrcNotFound : no record source found with the id "' + src_key + '"' );}

			let res = merge( {}, record_src.get( { plain:true } ) );
			delete res[model.primaryKeyField];
			delete res.createdAt; delete res.created_at;
			delete res.updatedAt; delete res.updated_at;
			// if( model.beforeDuplicate )	model.beforeDuplicate( res );
			if( model.beforeClone ){    model.beforeClone( res, record_src, options, me );}
			if( options.properties ){   merge( res, options.properties );}

			return me.create( model_key, res, { credentials:options.credentials } );
		})
		.then( function( created ){
			let pr = Promise.resolve( created );
			if( model.onAfterClone ){
				// let res = model.onDuplicate( created, record_src, options );
				let res = model.onAfterClone( created, record_src, options, me );
				if( !res || !res.then ){    res = Promise.resolve( res );}
				pr = res.then( function(){
					return created;
				} );
			}

			return pr;
		})
		;

	},
	getModel( model_key, scopes ){//scope_key, auth
		const me = this;
		return new Promise( function( resolve, reject ){
			let model = me.database.models[ model_key ];
			if(!model){   return reject( new Error('UnknownModel \''+model_key+'\'') );}
			if( typeof scopes !== 'undefined'){     model = model.scope( scopes );}
			// if( scopes )    model = me.applyScopes( model, scopes );
			if( me.options.debug ){   console.log('...getModel', model_key, model._scope );}
			return resolve( model );
		});
	},
	getModels(){    return this.database.models;},
	importModels( models, options = {} ){
		const me = this;

		return Promise.resolve()
		.then(function( ){
			const prs = {};
			for(let key in models ){
				if( models[key].disabled ){   continue;}
				prs[key] = me.importModel( Path.join( options.dir_models||__dirname, key ) );
			}
			return Promise.props( prs );
		})
		.then(function( imports ){
			if( me.options.debug ){   console.log('...models imported', imports );}

			if( isFunction( me.options.onModels ) ){
				me.options.onModels( imports, me.database, me );
			}

			return Promise.each( Object.keys( imports ), function( item, index ){
				return afterImportModel( imports[item], models[item], me.options, me.database );
			});
		})
		;
	},
	importModel( path, options ){
		const me = this;
		if(me.options.debug){   console.log('...import model', path );}
		return new Promise(function( resolve, reject ){
			let model = me.database.import( path );
			if( !model ){   reject( new Error('NullImportedModel : check Class is returned in model file '+path+'.') );}
			return resolve( model );
		})
		.then(function( model ){
			if( options ){    return afterImportModel( model, options, me.options, me.database );}
			return model;
		})
		;
	}
});


function afterImportModel ( model, modelOptions = {}, options = {}, database ){

	let pr = Promise.resolve( model );
	
	if( options.model_owner && modelOptions.roles ){
		const model_owner = database.models[options.model_owner];
		if( model !== model_owner ){
			if(!model_owner){  throw new Error('No owner model found with key "'+options.model_owner+'".');}
			const foreignKey = modelOptions.model_owner_fk || options.model_owner_fk;
			if( options.debug ){  console.log('...model.auth relation', foreignKey );}
			model.belongsTo( model_owner, { foreignKey } );
		}
	}

	if( modelOptions.sync ){
		let sync = merge( {}, modelOptions.sync );
		//_ insure force will work only on dbname_test and so prevent destroying prod db
		sync.match = /_test$/;
		if( options.debug ){    console.log('...model.sync', model.name, sync );}
		pr = model.sync( sync );
	}

	if( isFunction( modelOptions.mock ) ){
		if( options.debug ){    console.log('...model.mock', model.name );}
		pr = pr.then(function(){
			return modelOptions.mock( model );
		});
	}

	return pr.then(function( ){
		return model;
	});
}

module.exports = DbCrud;
