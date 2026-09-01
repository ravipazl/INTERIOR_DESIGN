export function convertToTitleCase(inputString) {
  // Replace underscores with spaces and split into words
  const words = inputString.split("_");

  // Capitalize the first letter of the first word and join the rest
  const formattedString =
    words[0].charAt(0).toUpperCase() +
    words[0].slice(1) +
    " " +
    words.slice(1).join("");

  return formattedString;
}

export function convertToSentenceCase(inputString) {
  const words = inputString.split("_");
  const formattedString = words.map(
    (word) => word.charAt(0).toUpperCase() + word.slice(1)
  );
  return formattedString.join(" ");
}

export function convertToTitle(inputString) {
  const words = inputString.split("_");

  const formattedString = words
    .slice(1)
    .map(
      (word, index) =>
        (index === 0 ? word.charAt(0).toUpperCase() : word.charAt(0)) +
        word.slice(1)
    )
    .join(" ");

  return formattedString;
}

//Remove duplicate array
export function removeDuplicateArrays(arrays) {
  const uniqueArrayKeys = new Set();
  const result = [];

  for (const array of arrays) {
    // Convert the array to a string representation
    const arrayKey = JSON.stringify(array);

    // Check if this string representation is already in the Set
    if (!uniqueArrayKeys.has(arrayKey)) {
      // If not, add it to the Set and push the array to the result
      uniqueArrayKeys.add(arrayKey);
      result.push(array);
    }
  }

  return result;
}

export function getUniqueElementsByKey(array, key) {
  const arrayUniqueByKey = [
    ...new Map(array.map((item) => [item[key], item])).values(),
  ];
  return arrayUniqueByKey;
}

export function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function handleKeyPressEventForEscape() {
  const escKeyEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true, // This allows the event to propagate
  });
  return escKeyEvent;
}

export function handleKeyPressEvent() {
  const escKeyEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true, // This allows the event to propagate
  });
  return escKeyEvent;
}

export const capitalizeText = (text) => {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text
    .replaceAll("_", " ")
    .split(" ")
    .map((str) => {
      if (str && str.length > 0) {
        return str[0].toUpperCase() + str.slice(1);
      } else {
        return str; // Return the empty string or undefined as is
      }
    })
    .join(" ");
};
