import { Database, OPEN_CREATE, OPEN_READONLY, OPEN_READWRITE } from 'sqlite3';

function getDBConnecton(mode = OPEN_READONLY): Database {
    return new Database('./database.sqlite', mode, (err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Connected to SQLite database.');
    });
}

export const getReadDBConnecton = () => getDBConnecton(OPEN_READONLY);
export const getWriteDBConnecton = () => getDBConnecton(OPEN_READWRITE);
export const getAdminDBConnecton = () => getDBConnecton(OPEN_READWRITE | OPEN_CREATE);
