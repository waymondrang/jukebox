import { createStore } from 'vuex';

export default createStore({
   state: {
      queue: [], // songs user wants to play
      afterQueue: [], // songs subsequent after (not explicitly selected)
      tracks: [], // all tracks user is currently pointed at
      user: null,
   },
   mutations: {
      addTrack(state, track) {
         // probability of collision is NOT 0, but its close enough c:
         state.queue.push({ track: track, is_queue: true, id: Math.random().toString(16).slice(2) })
      },
      setQueueToTrack(state, track) {
         state.queue = [
            { track: track, is_queue: false, id: Math.random().toString(16).slice(2) } 
         ]
      },
      removeTrack(state, track) {
         let idx = state.queue.indexOf(track)
         if (idx >= 0) state.queue.splice(idx, 1)  
      },
      skipQueueTo(state, track) {
         let idx = state.queue.indexOf(track)
         if (idx >= 0) state.queue = state.queue.slice(idx)
      },
      popTrack(state) {
         state.queue.shift()
      },
      setQueue(state, queue) {
         state.queue = queue
      },
      setUser(state, user) {
         state.user = user
      },
      setAfterQueue(state, queue) {
         state.afterQueue = queue
      },
      setTracks(state, tracks) {
         state.tracks = tracks
      }
   },
   actions: {
      addTrack({ commit }, track) {
         commit("addTrack", track)
      },
      setQueueToTrack({ commit }, track) {
         commit("setQueueToTrack", track)
      },
      removeTrack({ commit }, track) {
         commit("removeTrack", track)
      },
      skipQueueTo({ commit }, track) {
         commit("skipQueueTo", track)
      },
      setQueue({ commit }, queue) {
         commit("setQueue", queue)
      },
      setUser({ commit }, user) {
         commit("setUser", user)
      },
      setAfterQueue({ commit }, queue) {
         commit("setAfterQueue", queue)
      },
      setTracks({ commit }, tracks) {
         commit("setTracks", tracks)
      },
      popTrack({ commit }) {
         commit("popTrack")
      }
   },
   getters: {
      getQueue: state => state.queue,
      getUser: state => state.user,
      getAfterQueue: state => state.afterQueue,
      getTracks: state => state.tracks
   }
});
