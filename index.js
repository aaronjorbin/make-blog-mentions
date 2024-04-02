const WPAPI = require( 'wpapi' );
const fs = require( 'fs' );
const crypto = require( 'crypto' );
const https = require( 'https' );
const _ = require( 'lodash' );

const tag = 5388; // '6-5';
const makeSite = 'https://make.wordpress.org/core/';

// instantiate the WPAPI client
const wp = new WPAPI( {
	endpoint: makeSite + 'wp-json',
} );

// setup our data object
const data = {
	total: {},
	author: {},
	mentions: {},
	comments: {},
	people: {},
};

/**
 * Retrieves all responses by recursively making requests to the next page.
 *
 * @param {Promise} request - The initial request promise.
 * @returns {Promise} A promise that resolves to an array of all responses.
 */
function getAll( request ) {
	return request.then( function ( response ) {
		if ( ! response._paging || ! response._paging.next ) {
			return response;
		}
		// Request the next page and return both responses as one collection
		return Promise.all( [
			response,
			getAll( response._paging.next ),
		] ).then( function ( responses ) {
			const data = _.flatten( responses );
			return data;
		} );
	} );
}

/**
 * Adds data to the specified type, key, and id.
 *
 * @param {string} type - The type of data.
 * @param {string} key - The username for the data.
 * @param {string} id - The Post ID of the data.
 */
function addData( type, key, id ) {
	if ( ! data[ type ][ key ] ) {
		data[ type ][ key ] = new Set();
		data.people[ key ] = {
			total: new Set(),
			author: new Set(),
			mentions: new Set(),
			comments: new Set(),
		};
	}
	if ( ! data.total[ key ] ) {
		data.total[ key ] = new Set();
	}

	data.total[ key ].add( id );
	data[ type ][ key ].add( id );

	data.people[ key ][ type ].add( id );
	data.people[ key ].total.add( id );
}

/**
 * Retrieves the author name based on the provided ID.
 *
 * @param {number} id - The ID of the author.
 * @returns {Promise<string>} The slug of the author.
 */
async function getAuthorName( id ) {
	const author = await wp.users().id( id );
	return author.slug;
}

/**
 * Extracts mentions from the given text and adds them to the data.
 *
 * @param {string} text - The text to search for mentions.
 * @param {string} id - The ID of the data to add the mentions to.
 * @returns {void}
 */
function doMentions( text, id ) {
	const regex = /profiles.wordpress.org\/([a-zA-Z0-9_-]+)/gi;
	let match;
	while ( ( match = regex.exec( text ) ) ) {
		addData( 'mentions', match[ 1 ], id );
	}
}

/**
 * Retrieves the author name by their ID from the WordPress profiles website.
 *
 * @param {number} id - The ID of the author.
 * @returns {Promise<string>} A promise that resolves to the author's username.
 * @throws {string} If there is an error retrieving the author name.
 */
async function getAuthorNameById( id ) {
	// got to a url like https://profiles.wordpress.org/13895437 and it will redirect to https://profiles.wordpress.org/janthiel/, we want the `janthiel` part
	const url = `https://profiles.wordpress.org/${ id }`;
	return new Promise( ( resolve, reject ) => {
		https.get( url, ( res ) => {
			if ( res.statusCode !== 301 ) {
				reject( 'Error' );
			}
			// get the location header and remove the trailing slash
			const location = res.headers.location.replace( /\/$/, '' );
			const username = location.split( '/' ).pop();
			resolve( username );
		} );
	} );
}

/**
 * Retrieves comments for a given post and adds data to the 'comments' collection.
 *
 * @param {Object} post - The post object.
 * @returns {Promise<void>} - A promise that resolves when all comments have been processed.
 */
async function getComments( post ) {
	const comments = await getAll( wp.comments().post( post.id ) );
	for ( let comment of comments ) {
		try {
			const author = await getAuthorNameById( comment.author );
			addData( 'comments', author, post.id );
		} catch ( e ) {
			console.log( comment );
			console.error( e );
		}
	}
}

/**
 * Converts data to CSV format.
 *
 * @param {Object} data - The data to be converted.
 * @returns {string} The data in CSV format.
 */
function toCSV( data ) {
	let csv = 'name,author,mentions,comments,total\n';
	for ( let name in data ) {
		csv += `${ name },${ data[ name ].author.size },${ data[ name ].mentions.size },${ data[ name ].comments.size },${ data[ name ].total.size }\n`;
	}
	return csv;
}

/**
 * Returns a string representation of the values in a Set wrapped in double quotes.
 *
 * @param {Set} set - The Set object to extract values from.
 * @returns {string} - A string representation of the values in the Set.
 */
function getValuesFromSet( set ) {
	return '"' + JSON.stringify( Array.from( set ) ) + '"';
}

/**
 * Converts data to CSV format.
 *
 * @param {Object} data - The data object containing name, author, mentions, comments, and total.
 * @returns {string} The data converted to CSV format.
 */
function toCSVData( data ) {
	let csv = 'name,author,mentions,comments,total\n';
	for ( let name in data ) {
		const author = getValuesFromSet( data[ name ].author );
		const mentions = getValuesFromSet( data[ name ].mentions );
		const comments = getValuesFromSet( data[ name ].comments );
		const total = getValuesFromSet( data[ name ].total );
		csv += `${ name },${ author },${ mentions },${ comments },${ total }\n`;
	}
	return csv;
}

( async function () {
	const posts = await getAll( wp.posts().tag( tag ) );
	for ( let post of posts ) {
		const author = await getAuthorName( post.author );
		addData( 'author', author, post.id );
		doMentions( post.content.rendered, post.id );
		await getComments( post );
	}
	fs.writeFileSync( 'output.csv', toCSV( data.people ) );
	fs.writeFileSync( 'allData.csv', toCSVData( data.people ) );
} )().catch( console.error );
