# nodejs-crud
**Wrapper of Sequelize ORM with CRUD operations & authorization level access.**

The permission access works by simply adding a User owner relation to each model, 
then checking if operation allowed by the credentials role.
If permission access is special 'owner', each CRUD operation request (but create) 
will be augmented with a corresponding WHERE condition.
## Usage
```
const DbCrud = require('@dmidz/crud');

//_ create an instance
const crud = new DbCrud({
    dir_models : Path.join( __dirname, 'models' ),//_ path to your Sequelize models
    db_sequelize : {//_ Sequelize instantiation options passed as is
        database : 'db_test',
        // ...
    },
    auth_enabled: true,//_ if enabled, crud actions will check user permissions
    model_owner:'User',//_ required if auth_enabled, defaults to 'User'
    model_owner_fk: 'owner_id',//_ required if auth_enabled, user foreign key in restricted models
    models: {//_ models options
        User:{
            sync:{//_ Sequelize sync option
                force:true,//_ only for dev : should use migration scripts
            },
            roles : {//_ auth roles, each key is a role, which will be test against the credentials' role
                user:{//_ value either an object with crud operations
                    read:'owner',//_ special string 'owner' means allowed only for owner user 
                },
                admin:1,//_ a bool like is a shortcut for all actions ( admin can do everything here )
            },
            mock( model ){//_ helper to insert mock data at start
                return model.bulkCreate([
                    { login:'admin@domain.org', password: 'demo', roles: 'admin' },
                    { login:'user1@domain.org', password: 'demo', roles: 'user' },
                    { login:'user2@domain.org', password: 'demo', roles: 'user' }
                ] )
                .then(function( users ){
                    //_ can do things with added mock entries
                })
                ;
            }
        },
        Task:{
            sync:{ force:true },
            // disabled:1,
            roles:{
                admin:1,//_ admin can performm every action on every entry
                 user: 'owner',//_ users can perform every action only on entries they own
            }
        },
    },
    onModels : function( models, Sequelize, plugin ){
        //__ good place for associations ( after all models loaded but before sync )
        models.Task.hasMany( models.Task, { as: 'children', foreignKey: 'parent' } );//_ Task could have sub tasks
    }
});

//_ create 2 tasks with admin creds
crud.create('Task', [
    { title: 'Task 1'/*, owner_id:1*/ },//_ if no owner set, creds.id will be used
    { title: 'Task 2', owner_id:2 }//_ set owner user 2
], { credentials:{ id: 1, roles: 'admin' }, bulk:1 } )
.then(function( tasks ) {
    console.log('# all tasks inserted', tasks );
    //_ reading model with access role "owner" should return only owned ones.
    crud.read('Task', { raw:true, credentials: { id: 2, roles: 'user' }, scopes:'collection' } )
    .then(function( res ) {
        //_ the result should be 1 row owned by user 2
        console.log('### res :', res.length, res );
    })
});
```
Please check out [the test for more detail](test). 