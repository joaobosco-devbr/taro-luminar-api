const fs = require('fs');
const path = require('path');

const usersFile = path.join(__dirname, '../storage/users.json');

function getUsers() {
  return JSON.parse(fs.readFileSync(usersFile));
}

function saveUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function registerUser({ name, email }) {
  const users = getUsers();

  let user = users.find(u => u.email === email);
  if (user) return user;

  user = {
    id: Date.now(),
    name,
    email,
    credits: 0
  };

  users.push(user);
  saveUsers(users);

  return user;
}

function addCredit(email, amount = 1) {
  const users = getUsers();
  const user = users.find(u => u.email === email);

  if (!user) return null;

  user.credits += amount;
  saveUsers(users);

  return user;
}

function consumeCredit(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);

  if (!user || user.credits <= 0) return false;

  user.credits -= 1;
  saveUsers(users);

  return true;
}

module.exports = {
  registerUser,
  addCredit,
  consumeCredit
};

