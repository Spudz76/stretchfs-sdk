//
// Created by tbutler on 7/7/2018.
//

#include "../include/sfs_api.h"
#include "../include/memory.h"
#include "../include/state.h"
#include "../include/curl.h"

size_t
SFS_Login(void *userp,char username[],char password[]){
    auto StateStruct *state = (StateStruct *) userp;
    PostOpts post;
    sprintf(post.uri,"/user/login");
    post.json = json_object_new_object();
    json_object_object_add(post.json, "tokenType", json_object_new_string("permanent"));
    json_object_object_add(post.json, "username", json_object_new_string(username));
    json_object_object_add(post.json, "password", json_object_new_string(password));
    CURLcode rv = PostCURL(userp,post);
    if(CURLE_OK == rv){
        //handle session data
        struct json_object *session;
        json_object_object_get_ex(state->curl.recvd.parsed,"session",&session);
        struct json_object *value;
        json_object_object_get_ex(session,"UserId",&value);
        state->session.UserId = json_object_get_int64(value);
        json_object_object_get_ex(session,"token",&value);
        sprintf(state->session.token,"%s",json_object_get_string(value));
    }
    return rv;
}
