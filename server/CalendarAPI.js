var Q = require('q');
var google = require('googleapis');
var gcal = google.calendar('v3');

var Configstore = require('configstore');
var conf = new Configstore('menu-calendar');

var store = new (require('./CalendarStore'))();

export default class Calendar {


  /*
   * Store the auth client to use with api calls
   */

  setAuth(oauth) {
    this.oauth = oauth;
  }


  /*
   * Run the event sync process
   *  If we have a syncToken in storage, initial sync is done, so use it to fetch the changed items
   *  If we have a pageToken in storage, we're in the middle of a sync so grab the next page
   */

  syncEvents () {

    console.log("Calendar: syncing")

    // fetch any sync tokens we have from storage
    var syncTokens = conf.get('sync-tokens') || {};
    var nextSyncToken = syncTokens.nextSyncToken;
    var nextPageToken = syncTokens.nextPageToken;

    var queryOpts = {
      auth: this.oauth.client,
      calendarId: 'primary',
      maxResults: 100,
      timeZone: 'GMT',
      singleEvents: true
    };

    // update the queryOpts based on the tokens we have
    if (nextSyncToken) {
      queryOpts.syncToken = nextSyncToken;
    } else if (!nextPageToken) {
      var today = new Date();
      today.setHours(0);
      today.setMinutes(0);
      today.setSeconds(0);
      var later = new Date(today);
      later.setDate(later.getDate() + 100);
      queryOpts.timeMin = today.toISOString();
      queryOpts.timeMax = later.toISOString();
    }

    if (nextPageToken) {
      queryOpts.pageToken = nextPageToken;
    }

    // perform the request
    return Q.nfcall(gcal.events.list, queryOpts)
      .then((res) => {

        console.log("Calendar: list response")

        var obj = res[0];

        if (obj.nextSyncToken) {

          // we have a syncToken which means we're done for now
          syncTokens.nextSyncToken = obj.nextSyncToken;
          delete syncTokens.nextPageToken;
          conf.set('sync-tokens', syncTokens);

          console.log("Done syncing...")

          var remove = [];
          var save = [];

          obj.items.forEach(function (i) {
            if (i.status == 'cancelled') {
              remove.push(i);
            } else {
              save.push(i);
            }
          });

          // save the items and return
          return store.setItems(save)
          .then((resp) => {
            if (remove.length) {
              return store.removeItems(remove);
            } else {
              return;
            }
          });

        } else if (obj.nextPageToken) {

          // we have a pageToken, keep fetching
          syncTokens.nextPageToken = obj.nextPageToken;
          conf.set('sync-tokens', syncTokens);

          console.log("Fetching next page...")

          // save the items and continue syncing
          return store.setItems(obj.items)
          .then((resp) => {
            return this.syncEvents();
          })
        }

      });
  }
}