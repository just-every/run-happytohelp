import React from 'react';

/** An address may wrap before its @, never inside a word. */
export default function emailAddress(email) {
    const at = String(email || '').lastIndexOf('@');
    return at > 0 ? <>{ email.slice(0, at) }<wbr />{ email.slice(at) }</> : email;
}
