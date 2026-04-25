function safeIsNaN(value) {
  return typeof value === "number" && value !== value;
}

function isEqual(first, second) {
  if (first === second) {
    return true;
  }

  if (safeIsNaN(first) && safeIsNaN(second)) {
    return true;
  }

  return false;
}

function areInputsEqual(newInputs, lastInputs) {
  if (newInputs.length !== lastInputs.length) {
    return false;
  }

  for (let index = 0; index < newInputs.length; index += 1) {
    if (!isEqual(newInputs[index], lastInputs[index])) {
      return false;
    }
  }

  return true;
}

export default function memoizeOne(resultFn) {
  let lastArgs = [];
  let lastResult;
  let isFirstCall = true;

  return function memoized(...args) {
    if (!isFirstCall && areInputsEqual(args, lastArgs)) {
      return lastResult;
    }

    lastResult = resultFn.apply(this, args);
    lastArgs = args;
    isFirstCall = false;

    return lastResult;
  };
}
