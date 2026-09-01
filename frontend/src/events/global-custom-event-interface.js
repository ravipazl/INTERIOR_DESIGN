const GlobalCustomEvent = {};

GlobalCustomEvent.eventListeners = {};
GlobalCustomEvent.lastDispatchTime = {};

GlobalCustomEvent.addEventListener = (eventName, callback) => {
  if (!GlobalCustomEvent.eventListeners[eventName]) {
    GlobalCustomEvent.eventListeners[eventName] = [];
  }
  // Check if the callback is already registered for this event
  if (GlobalCustomEvent.eventListeners[eventName].indexOf(callback) === -1) {
    GlobalCustomEvent.eventListeners[eventName].push(callback);
  }
};

GlobalCustomEvent.removeEventListener = (eventName, callback) => {
  if (GlobalCustomEvent.eventListeners[eventName]) {
    const index = GlobalCustomEvent.eventListeners[eventName].indexOf(callback);
    if (index !== -1) {
      GlobalCustomEvent.eventListeners[eventName].splice(index, 1);
    }
  }
};

GlobalCustomEvent.dispatchEvent = (eventName, data) => {
  if (GlobalCustomEvent.eventListeners[eventName]) {
    const currentTime = Date.now();
    const lastDispatch = GlobalCustomEvent.lastDispatchTime[eventName] || 0;
    //if (currentTime - lastDispatch >= 500) {
      GlobalCustomEvent.lastDispatchTime[eventName] = currentTime;
      if (GlobalCustomEvent.eventListeners[eventName][0]) {
        GlobalCustomEvent.eventListeners[eventName][0](data);
      }
    //}
  }
};

export default GlobalCustomEvent;
