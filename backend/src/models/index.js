// Registers every model (and its associations) with Sequelize, for the server and `npm run migrate`
require('./User');
require('./Department');
require('./UserDepartment');
require('./EditLog'); // older cell-edit history, copied into audit_logs once
require('./AuditLog');
require('./AccessRule');
require('./HiddenRow');
require('./Workbook');
require('./UserPhoto');
