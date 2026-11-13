/* global rs, sleep, quit */
try { rs.status(); }
catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({ _id: 'atlas', members: [
    { _id: 0, host: 'mongo1:27017' },
    { _id: 1, host: 'mongo2:27017' },
    { _id: 2, host: 'mongo3:27017' },
  ] });
}
for (let i = 0; i < 120; i++) {
  if (rs.status().members.some(m => m.stateStr === 'PRIMARY')) quit(0);
  sleep(1000);
}
quit(1);
