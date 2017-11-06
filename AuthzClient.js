const GrantManager = require('keycloak-auth-utils').GrantManager,
      KcConfig = require('keycloak-auth-utils').Config,
      ProtectedResource = require('./ProtectedResource'),
      AdminResource = require('./AdminResource'),
      EntitlementResource = require('./EntitlementResource'),
      request = require('request-promise-native');

class AuthzClient {

    constructor({url, realm, clientId, credentials = {}, publicClient = false, realIss = null}){
        if(!url) throw new Error("Required param is missing: url");
        if(!realm) throw new Error("Required param is missing: realm");
        if(!clientId) throw new Error("Required param is missing: clientId");

        this._kcUrl = url;
        this._realm = realm;
        this._clientId = clientId;
        this._credentials = credentials;
        this._public = publicClient;
        this._grant = null;
        this._grantManager = null;
        this._protectedResource = new ProtectedResource(this);
        this._entitlementResource = new EntitlementResource(this);
        this._adminResource = new AdminResource(this);
        this._clientInfo = null;
        // Hack: if keycloak works in private network, we should be able to validate token with custom iss
        this.realIss = realIss;
    }

    isAuthenticated(){
        return !!(this._grant && !this._grant.isExpired());
    }

    authenticate(){
        if(this.isAuthenticated()) return Promise.resolve(true);
        const config = new KcConfig({
            realm: this._realm,
            clientId: this._clientId,
            secret: this._credentials.secret,
            serverUrl: this._kcUrl + "/auth",
            public: this._public
        });
        this._grantManager = new GrantManager(config);
        let promise = Promise.resolve(false);
        if ( this._credentials.password ) {
            promise = this._grantManager.obtainDirectly( this._credentials.username, this._credentials.password );
        } else {
            promise = this._grantManager.obtainFromClientCredentials();
        }
        return promise.then((grant) =>{
            this._grant = grant;
            return this.getClientInfo();
        }).then(()=>{
            return true;
        });
    }

    getClientInfo(){
        return this.refreshGrant().then(()=>{
            let options = {
                method: 'GET',
                uri: `${this.url}/auth/admin/realms/${this.realm}/clients?viewableOnly=true`,
                headers: {
                    "Authorization": `Bearer ${this.grant.access_token.token}`
                },
                json: true
            };
            return request(options).then((clientList) =>{
                this._clientInfo  = clientList.filter(client =>{
                    return client.clientId === this.clientId
                }).shift();
                return this._clientInfo;
            })
        }).catch(response =>{
            throw new Error(response.error);
        });
    }

    refreshGrant(){
        return this._grantManager
            .ensureFreshness(this._grant)
            .then((freshGrant) =>{
                this._grant.update(freshGrant);
                return true;
            })
            .catch(exception =>{
                console.error("Cannot refresh grant", exception);
                this._grant = false;
                return false;
            });
    }

    userInfo(token = this._grant.access_token.token ){
        return this._grantManager
            .userInfo(token)
    }

    resource(){
        if(!this.isAuthenticated()) throw new Error("Authentication required");
        return this._protectedResource;
    }

    entitlement(){
        if(!this.isAuthenticated()) throw new Error("Authentication required");
        return this._entitlementResource;
    }

    admin(){
        if(!this.isAuthenticated()) throw new Error("Authentication required");
        return this._adminResource;
    }

    get grant(){
        if(!this.isAuthenticated()) throw new Error("Authentication required");
        return this._grant;
    }

    get url(){
        return this._kcUrl;
    }

    get clientId(){
        return this._clientId;
    }

    get realm(){
       return this._realm;
    }

    get grantManager(){
        return this._grantManager;
    }

    get credentials(){
        return this._credentials;
    }

    get clientInfo(){
        return this._clientInfo;
    }
}

module.exports = AuthzClient;