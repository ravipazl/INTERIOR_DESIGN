import React, { createContext, useContext, useReducer } from "react";

const initialState = {
  historyStatus: null,
  favoriteStatus: null,
};

export const CountContext = React.createContext();

const countReducer = (state, action) => {
  switch (action.type) {
    case "SET_HISTORY_STATUS":
      return { ...state, historyStatus: action.payload };
    case "SET_FAVORITE_STATUS":
      return { ...state, favoriteStatus: action.payload };
    default:
      return state;
  }
};
export const CountProvider = ({ children }) => {
  const [state, dispatch] = useReducer(countReducer, initialState);

  const setHistoryStatus = (value) => {
    dispatch({ type: "SET_HISTORY_STATUS", payload: value ? value : 'updated'});
  };

  const setFavoriteStatus = (value) => {
    dispatch({ type: "SET_FAVORITE_STATUS", payload: value ? value : 'updated' });
  };

  return (
    <CountContext.Provider
      value={{
        historyStatus: state.historyStatus,
        favoriteStatus: state.favoriteStatus,
        setHistoryStatus,
        setFavoriteStatus,
      }}
    >
      {children}
    </CountContext.Provider>
  );
};
