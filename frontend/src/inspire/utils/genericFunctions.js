// The single password rule for the whole app. Was duplicated in SignUp (regex)
// and InviteTeamsModal (separate flags); kept here so the invite / set-password
// pages cannot drift to a weaker rule than signup.
// NOTE: no special character is required — the signup copy of this rule never
// required one either, despite its old error text claiming so.
export const PASSWORD_RULE_MESSAGE =
  "Your password should have a minimum of 8 characters, a number, lowercase and uppercase.";

export function validatePassword(password) {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  return passwordRegex.test(password);
}

export async function removeDuplicatesInArray(array) {
  const set = new Set();
  for (const element of array) {
    set.add(element);
  }
  let newArray = [...set];
  newArray = newArray.filter(
    (element) => element !== undefined && element !== "" && element !== ".DS_Store"
  );
  return newArray;
}

export function formatDate(inputDate) {
  const date = new Date(inputDate);
  const currentDate = new Date();
  const day = date.getDate();
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;

  const yesterday = new Date(currentDate);
  yesterday.setDate(currentDate.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${formattedHours}:${(minutes < 10 ? '0' : '')}${minutes} ${ampm}`;
  } else if (date.toDateString() === currentDate.toDateString()) {
    return `Today ${formattedHours}:${(minutes < 10 ? '0' : '')}${minutes} ${ampm}`;
  } else {
    const formattedDate = `${day} ${month} ${year} ${formattedHours}:${(minutes < 10 ? '0' : '')}${minutes} ${ampm}`;
    return formattedDate;
  }
}
