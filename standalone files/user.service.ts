
/**
 * @Author: bnockles
 * @Date:   2021-02-06T23:43:00+09:00
 * @Last modified by:   bnockles
 * @Last modified time: 2021-06-02T23:48:20+09:00
 */



import { Injectable } from '@angular/core';
import { AngularFirestore, AngularFirestoreDocument } from '@angular/fire/firestore';
import { AngularFireAuth } from '@angular/fire/auth';
import { switchMap, catchError, retry, share } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { AngularFireFunctions } from '@angular/fire/functions';
import { CreateUserOutput } from '../cloud-function-types';
import { User } from '../data-models/data-models';
import { AlertService } from '../alert/alert.service';
import { AngularFireAnalytics } from '@angular/fire/analytics';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  loggedIn: boolean = false;
  private _userDoc: AngularFirestoreDocument<User>;
  private _userData: User;
  private _uid: string;
  userDoc$: Observable<User>;
  private _isModerator: boolean = false;


  /**
   * 
   * @param afs - Database
   * @param auth - Manages authentication
   * @param fns - Handle cloud functions
   * @param as - Alerts that are presented to the user
   * @param analytics - Manages Google Analytics
   */
  constructor(private afs: AngularFirestore, private auth: AngularFireAuth, private fns: AngularFireFunctions, private as: AlertService, private analytics: AngularFireAnalytics) {

    //auth.user emits whenever there is a change to the user's authentication status
    this.userDoc$ = this.auth.user.pipe(
      //switchPipe will "switch" to observing the document (Cloud Fiestore) data, rather than user.auth
      switchMap(
        authUser => {
          console.log('logged in')
          if (authUser ?.uid) {
            //the user's document is from Cloud Firestore (afs)
            this._userDoc = this.afs.doc<User>('users/' + authUser.uid)
            //valueChanges returns an observable
            return this._userDoc.valueChanges({ idField: 'id' });
          } else {
            //make sure to return something observable or there will be errors on subscrtiptions to user
            //'of' just returns the object as an observsable
            return of(null);
          }
        }
      ),
      //if the user does not exist, CloudeFirebase will throw a permission-denied error. This means we need to initialize the data
      catchError(
        err => {
          if (err.code == 'permission-denied') {
            console.log('permission was denied')
            //initialization is done using a cloud function
            const createUser: (_: any) => Observable<CreateUserOutput> = this.fns.httpsCallable('createUser');

            return createUser(null).toPromise().then(createUserOutput => {
              //if the cloud function is successfull, notify the user and return the resulting document
              if (createUserOutput.success) {
                console.log('doc was initialized')
                //frontend display:
                this.notifyInitializationSucceess();

                //now get the user doc:
                this._userDoc = this.afs.doc<User>('users/' + createUserOutput.userData.id)

                return this._userDoc.valueChanges({ idField: 'id' });
              } else {
                //frontend notification:
                this.notifyInitializationFailure();

                //if the  cloud function failed, we can throw an error and depending on if any part was successful, maybe the doc will be rtrived on retry (below)
                throw new Error(createUserOutput.error)
              }
            })
          } else if (err.code == 'already-exists') {
            //just send the error along to be handeld by retry (below)
            return err;
          } else {
            //any other error
            this.notifyInitializationFailure();
            throw new Error('An unknown error has occured')
          }
        }),
      //retry once.  This might happen if the cloud funciton throws an error even though the doc was initialized
      retry(1),
      //share so that these requests aren't made more than once.
      share()
    );

    this.userDoc$.subscribe(
      userData => {
        console.log('first sub');
        if (userData) {
          this.loggedIn = true;
          this._userData = userData;
          this._isModerator = userData.moderator;
        } else {
          this.loggedIn = false;
        }

      },//on emission
      onError => {

      },//on error
      () => {

      }//on completion
    )

    // this.userDoc$.subscribe(
    //   userData => {
    //     console.log('second sub');
    //   }
    // )
  }

  private notifyInitializationSucceess() {
    this.analytics.logEvent('newAccount')
    this.as.success('Your Perfect Boardgame account was successfully attached to your Google sign in.', 'Welcome!');
  }

  private notifyInitializationFailure() {
    this.as.error('Account creation failed.');
  }

  get isAdmin(): boolean {
    return this._userData ?.permission == 'admin';
  }

  get userData(): User {
    return this._userData;
  }

  get uid(): string {
    if (this._userData) {
      return this._userData.id;
    } else {
      return null;
    }

  }

  

  get isModerator(): boolean {
    return this._isModerator;
  }

  receiveUpdateNotifications(): Promise<void> {
    var notificationsWrite: { [key: string]: boolean } = {}
    if (this._userData.notifications) {
      notificationsWrite = this._userData.notifications;
    }
    notificationsWrite.receiveUpdates = true;
    return this._userDoc.update(notificationsWrite);
  }



  favoriteGame(gameID: string, val: boolean): Promise<void> {
    return this._userDoc.update({ ['favorites.' + gameID]: val });
  }
}
