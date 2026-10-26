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
require('./WigSnapshot');
// (column_orders, from the removed "drag columns in your view" feature, is no longer used)
