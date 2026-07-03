const devLog = __DEV__ ? console.log.bind(console) : () => {};

export default devLog;
