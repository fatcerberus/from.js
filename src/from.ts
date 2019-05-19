/*
 *  from.js - LINQ-to-Objects for JavaScript
 *  Copyright (c) 2019, Fat Cerberus
 *  All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions are met:
 *
 *  * Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *  * Neither the name of miniSphere nor the names of its contributors may be
 *    used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
**/

type Queryable<T> = T[] | ArrayLike<T> | Iterable<T>;

type Aggregator<T, R> = (accumulator: R, value: T) => R;
type Iteratee<T> = (value: T) => void;
type JoinPredicate<T, U> = (lValue: T, rValue: U) => boolean;
type Predicate<T> = (value: T) => boolean;
type Selector<T, R> = (value: T) => R;
type ZipSelector<T, U, R> = (lValue: T, rValue: U) => R;

type TypeOfResult =
	| 'bigint'
	| 'boolean'
	| 'function'
	| 'number'
	| 'object'
	| 'string'
	| 'symbol'
	| 'undefined';

type TypeOf<K extends TypeOfResult> = {
	bigint: bigint,
	boolean: boolean,
	function: (...args: never[]) => unknown,
	number: number,
	object: object | null,
	string: string,
	symbol: symbol,
	undefined: undefined,
}[K];

interface Sequence<T> extends Iterable<T>
{
	forEach?(iteratee: Predicate<T>): boolean;
}

export = from;
function from<T>(source: Queryable<T>)
{
	return new Query(sequenceOf(source));
}

class Query<T> implements Iterable<T>
{
	readonly [Symbol.toStringTag] = "Query";

	protected sequence: Sequence<T>;

	constructor(sequence: Sequence<T>)
	{
		this.sequence = sequence;
	}

	[Symbol.iterator]()
	{
		return this.sequence[Symbol.iterator]();
	}

	aggregate<R>(aggregator: Aggregator<T, R>, seedValue: R)
	{
		let accumulator = seedValue;
		iterateOver(this.sequence, value => {
			accumulator = aggregator(accumulator, value);
			return true;
		});
		return accumulator;
	}

	all(predicate: Predicate<T>)
	{
		let matched = true;
		iterateOver(this.sequence, value => {
			matched = predicate(value);
			return matched;
		});
		return matched;
	}

	allIn(values: Queryable<T>)
	{
		const valueSet = new Set(sequenceOf(values));
		return this.all(it => valueSet.has(it));
	}

	any(predicate: Predicate<T>)
	{
		let foundIt = false;
		iterateOver(this.sequence, value => {
			if (predicate(value))
				foundIt = true;
			return !foundIt;
		});
		return foundIt;
	}

	anyIn(values: Queryable<T>)
	{
		const valueSet = new Set(sequenceOf(values));
		return this.any(it => valueSet.has(it));
	}

	anyIs(value: T)
	{
		const predicate = value !== value
			? (toCheck: T) => toCheck !== toCheck
			: (toCheck: T) => toCheck === value;
		return this.any(predicate);
	}

	apply<V, R>(this: Query<(value: V) => R>, values: Queryable<V>)
	{
		return this.selectMany(fn => from(values).select(fn));
	}

	average(this: Query<number>)
	{
		let count = 0;
		let sum = 0;
		iterateOver(this.sequence, (value) => {
			++count;
			sum += value;
			return true;
		});
		return sum / count;
	}

	besides(iteratee: Iteratee<T>)
	{
		return this.select(it => (iteratee(it), it));
	}

	concat(...sources: Queryable<T>[])
	{
		return new Query(new ConcatSeq(this.sequence, sources));
	}

	count()
	{
		let n = 0;
		iterateOver(this.sequence, () => (++n, true));
		return n;
	}

	distinct<K>(keySelector: Selector<T, K>)
	{
		return new Query(new DistinctSeq(this.sequence, keySelector));
	}

	elementAt(position: number)
	{
		let index = 0;
		let element: T | undefined;
		iterateOver(this.sequence, value => {
			element = value;
			return index !== position;
		});
		return element;
	}

	except(...blacklists: Queryable<T>[])
	{
		const exclusions = new Set(from(blacklists).selectMany(it => it));
		return new Query(new WithoutSeq(this.sequence, exclusions));
	}

	first(predicate: Predicate<T>)
	{
		let result: T | undefined;
		iterateOver(this.sequence, value => {
			if (predicate(value)) {
				result = value;
				return false;
			}
			return true;
		});
		return result;
	}

	forEach(iteratee: Iteratee<T>)
	{
		return iterateOver(this.sequence, it => {
			iteratee(it);
			return true;
		});
	}

	groupJoin<U, R>(joinSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, Iterable<U>, R>)
	{
		return this.select(lValue => {
			const rValues = from(joinSource)
				.where(it => predicate(lValue, it));
			return selector(lValue, rValues);
		});
	}

	invoke<V extends unknown[], R>(this: Query<(...args: V) => R>, ...args: V)
	{
		return this.select(fn => fn(...args));
	}

	join<U, R>(joinSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(joinSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
	}

	last(predicate: Predicate<T>)
	{
		let result: T | undefined;
		iterateOver(this.sequence, (value) => {
			if (predicate(value))
				result = value;
			return true;
		});
		return result;
	}

	ofType<K extends TypeOfResult>(...types: K[]): Query<TypeOf<K>>
	{
		const typeSet = new Set<TypeOfResult>(types);
		return this.where(it => typeSet.has(typeof it));
	}

	orderBy<K>(keySelector: Selector<T, K>, direction: 'asc' | 'desc' = 'asc')
	{
		return new SortedQuery(new OrderBySeq(this.sequence, keySelector, direction === 'desc'));
	}

	plus(...values: T[])
	{
		return new Query(new ConcatSeq(this.sequence, [ values ]));
	}

	reverse()
	{
		return this.thru(values => values.reverse());
	}

	select<R>(selector: Selector<T, R>)
	{
		return new Query(new SelectSeq(this.sequence, selector));
	}

	selectMany<R>(selector: Selector<T, Queryable<R>>)
	{
		return new Query(new SelectManySeq(this.sequence, selector));
	}

	sum(this: Query<number>)
	{
		return this.aggregate((acc, value) => acc + value, 0);
	}

	skip(count: number)
	{
		return new Query(new SkipSeq(this.sequence, count));
	}

	skipLast(count: number)
	{
		return new Query(new SkipLastSeq(this.sequence, count));
	}

	skipWhile(predicate: Predicate<T>)
	{
		return new Query(new SkipWhileSeq(this.sequence, predicate));
	}

	take(count: number)
	{
		return new Query(new TakeSeq(this.sequence, count));
	}

	takeLast(count: number)
	{
		// takeLast can't actually be lazy because we don't know where to start
		// until we know for sure we've seen the final element.
		return this.thru((values) => {
			return values.slice(-count);
		});
	}

	takeWhile(predicate: Predicate<T>)
	{
		return new Query(new TakeWhileSeq(this.sequence, predicate));
	}

	thru<R>(replacer: Selector<T[], Queryable<R>>)
	{
		return new Query(new ThruSeq(this.sequence, replacer));
	}

	toArray()
	{
		return arrayOf(this.sequence);
	}

	where(predicate: Predicate<T>)
	{
		return new Query(new WhereSeq(this.sequence, predicate));
	}

	without(...values: T[])
	{
		return new Query(new WithoutSeq(this.sequence, new Set(values)));
	}

	zip<U, R>(zipSource: Queryable<U>, selector: ZipSelector<T, U, R>)
	{
		return new Query(new ZipSeq(this.sequence, sequenceOf(zipSource), selector));
	}
}

class SortedQuery<T, K> extends Query<T>
{
	constructor(source: OrderBySeq<T, K>)
	{
		super(source);
	}

	thenBy<K>(keySelector: Selector<T, K>, direction: 'asc' | 'desc' = 'asc')
	{
		return new SortedQuery(new OrderBySeq(this.sequence, keySelector, direction === 'desc', true));
	}
}

class ArrayLikeSeq<T> implements Sequence<T>
{
	private source: ArrayLike<T>;

	constructor(array: ArrayLike<T>) {
		this.source = array;
	}
	*[Symbol.iterator]() {
		for (let i = 0, len = this.source.length; i < len; ++i)
			yield this.source[i];
	}
	forEach(iteratee: Predicate<T>) {
		for (let i = 0, len = this.source.length; i < len; ++i) {
			if (!iteratee(this.source[i]))
				return false;
		}
		return true;
	}
}

class ConcatSeq<T> implements Sequence<T>
{
	private sources: Queryable<T>[];
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, sources: Queryable<T>[]) {
		this.sequence = sequence;
		this.sources = sources;
	}
	*[Symbol.iterator]() {
		yield* this.sequence;
		for (let i = 0, len = this.sources.length; i < len; ++i)
			yield* sequenceOf(this.sources[i]);
	}
	forEach(iteratee: Predicate<T>) {
		if (!iterateOver(this.sequence, iteratee))
			return false;
		for (let i = 0, len = this.sources.length; i < len; ++i) {
			if (!iterateOver(sequenceOf(this.sources[i]), iteratee))
				return false;
		}
		return true;
	}
}

class DistinctSeq<T, K> implements Sequence<T>
{
	private keySelector: Selector<T, K>
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, keySelector: Selector<T, K>) {
		this.sequence = sequence;
		this.keySelector = keySelector;
	}
	*[Symbol.iterator]() {
		const foundKeys = new Set<K>();
		for (const value of this.sequence) {
			const key = this.keySelector(value);
			if (!foundKeys.has(key)) {
				foundKeys.add(key);
				yield value;
			}
		}
	}
	forEach(iteratee: Predicate<T>) {
		const foundKeys = new Set<K>();
		return iterateOver(this.sequence, value => {
			const key = this.keySelector(value);
			if (!foundKeys.has(key)) {
				foundKeys.add(key);
				if (!iteratee(value))
					return false;
			}
			return true;
		});
	}
}

class OrderBySeq<T, K> implements Sequence<T>
{
	private keyMakers: { keySelector: Selector<T, K>, descending: boolean }[];
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, keySelector: Selector<T, K>, descending: boolean, auxiliary = false) {
		const keyMaker = { keySelector, descending };
		if (auxiliary && sequence instanceof OrderBySeq) {
			this.sequence = sequence.sequence;
			this.keyMakers = [ ...sequence.keyMakers, keyMaker ];
		}
		else {
			this.sequence = sequence;
			this.keyMakers = [ keyMaker ];
		}
	}
	*[Symbol.iterator]() {
		const results = this.computeResults();
		for (let i = 0, len = results.length; i < len; ++i)
			yield results[i].value;
	}
	forEach(iteratee: Predicate<T>) {
		const results = this.computeResults();
		for (let i = 0, len = results.length; i < len; ++i) {
			if (!iteratee(results[i].value))
				return false;
		}
		return true;
	}
	private computeResults() {
		const keys: K[][] = [];
		const results: { index: number, value: T }[] = [];
		let index = 0;
		iterateOver(this.sequence, (value) => {
			const keyList = new Array<K>(this.keyMakers.length);
			for (let i = 0, len = this.keyMakers.length; i < len; ++i)
				keyList[i] = this.keyMakers[i].keySelector(value);
			keys.push(keyList);
			results.push({ index: index++, value });
			return true;
		});
		return results.sort((a, b) => {
			const aKeys = keys[a.index];
			const bKeys = keys[b.index];
			for (let i = 0, len = this.keyMakers.length; i < len; ++i) {
				const invert = this.keyMakers[i].descending;
				if (aKeys[i] < bKeys[i])
					return invert ? +1 : -1;
				else if (aKeys[i] > bKeys[i])
					return invert ? -1 : +1;
			}
			return a.index - b.index;
		});
	}
}

class SelectSeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, U>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, selector: Selector<T, U>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	*[Symbol.iterator]() {
		for (const value of this.sequence)
			yield this.selector(value);
	}
	forEach(iteratee: Predicate<U>) {
		return iterateOver(this.sequence, it => iteratee(this.selector(it)));
	}
}

class SelectManySeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, Queryable<U>>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, selector: Selector<T, Queryable<U>>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	*[Symbol.iterator]() {
		for (const value of this.sequence)
			yield* sequenceOf(this.selector(value));
	}
	forEach(iteratee: Predicate<U>) {
		return iterateOver(this.sequence, (value) => {
			const results = sequenceOf(this.selector(value));
			return iterateOver(results, iteratee);
		});
	}
}

class SkipSeq<T> implements Sequence<T>
{
	private count: number;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, count: number) {
		this.sequence = sequence;
		this.count = count;
	}
	*[Symbol.iterator]() {
		let skipsLeft = this.count;
		for (const value of this.sequence) {
			if (skipsLeft-- <= 0)
				yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		let skipsLeft = this.count;
		return iterateOver(this.sequence, value => {
			return skipsLeft-- <= 0 ? iteratee(value)
				: true;
		});
	}
}

class SkipLastSeq<T> implements Sequence<T>
{
	private count: number;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, count: number) {
		this.sequence = sequence;
		this.count = count;
	}
	*[Symbol.iterator]() {
		const buffer = new Array<T>(this.count);
		let ptr = 0;
		let skipsLeft = this.count;
		for (const value of this.sequence) {
			if (skipsLeft-- <= 0)
				yield buffer[ptr];
			buffer[ptr] = value;
			ptr = (ptr + 1) % this.count;
		}
	}
	forEach(iteratee: Predicate<T>) {
		const buffer = new Array<T>(this.count);
		let ptr = 0;
		let skipsLeft = this.count;
		return iterateOver(this.sequence, (value) => {
			if (skipsLeft-- <= 0) {
				if (!iteratee(buffer[ptr]))
					return false;
			}
			buffer[ptr] = value;
			ptr = (ptr + 1) % this.count;
			return true;
		});
	}
}

class SkipWhileSeq<T> implements Sequence<T>
{
	private sequence: Sequence<T>;
	private predicate: Predicate<T>;

	constructor(sequence: Sequence<T>, predicate: Predicate<T>) {
		this.sequence = sequence;
		this.predicate = predicate;
	}
	*[Symbol.iterator]() {
		let onTheTake = false;
		for (const value of this.sequence) {
			if (!onTheTake && this.predicate(value))
				onTheTake = true;
			if (onTheTake)
				yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		let onTheTake = false;
		return iterateOver(this.sequence, value => {
			if (!onTheTake && !this.predicate(value))
				onTheTake = true;
			return onTheTake ? iteratee(value)
				: false;
		});
	}
}

class TakeSeq<T> implements Sequence<T>
{
	private count: number;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, count: number) {
		this.sequence = sequence;
		this.count = count;
	}
	*[Symbol.iterator]() {
		let takesLeft = this.count;
		for (const value of this.sequence) {
			if (takesLeft-- <= 0)
				break;
			yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		let takesLeft = this.count;
		return iterateOver(this.sequence, value => {
			return takesLeft-- > 0 ? iteratee(value)
				: false
		});
	}
}

class TakeWhileSeq<T> implements Sequence<T>
{
	private sequence: Sequence<T>;
	private predicate: Predicate<T>;

	constructor(sequence: Sequence<T>, predicate: Predicate<T>) {
		this.sequence = sequence;
		this.predicate = predicate;
	}
	*[Symbol.iterator]() {
		for (const value of this.sequence) {
			if (!this.predicate(value))
				break;
			yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		return iterateOver(this.sequence, value => {
			if (!this.predicate(value))
				return false;
			return iteratee(value);
		});
	}
}

class ThruSeq<T, R> implements Sequence<R>
{
	private replacer: Selector<T[], Queryable<R>>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, replacer: Selector<T[], Queryable<R>>) {
		this.sequence = sequence;
		this.replacer = replacer;
	}
	[Symbol.iterator]() {
		const oldValues: T[] = arrayOf(this.sequence);
		const newValues = this.replacer(oldValues);
		return sequenceOf(newValues)[Symbol.iterator]();
	}
	forEach(iteratee: Predicate<R>) {
		const oldValues: T[] = arrayOf(this.sequence);
		const newValues = this.replacer(oldValues);
		return iterateOver(sequenceOf(newValues), value => {
			return iteratee(value);
		});
	}
}

class WhereSeq<T> implements Sequence<T>
{
	private predicate: Predicate<T>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, predicate: Predicate<T>) {
		this.sequence = sequence;
		this.predicate = predicate;
	}
	*[Symbol.iterator]() {
		for (const value of this.sequence) {
			if (this.predicate(value))
				yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		return iterateOver(this.sequence, value => {
			return this.predicate(value) ? iteratee(value)
				: true;
		});
	}
}

class WithoutSeq<T> implements Sequence<T>
{
	private sequence: Sequence<T>;
	private values: Set<T>

	constructor(sequence: Sequence<T>, values: Set<T>) {
		this.sequence = sequence;
		this.values = values;
	}
	*[Symbol.iterator]() {
		for (const value of this.sequence) {
			if (!this.values.has(value))
				yield value;
		}
	}
	forEach(iteratee: Predicate<T>) {
		return iterateOver(this.sequence, value => {
			return !this.values.has(value) ? iteratee(value)
				: true;
		});
	}
}

class ZipSeq<T, U, R> implements Sequence<R>
{
	private selector: ZipSelector<T, U, R>;
	private leftSeq: Sequence<T>;
	private rightSeq: Sequence<U>;

	constructor(leftSeq: Sequence<T>, rightSeq: Sequence<U>, selector: ZipSelector<T, U, R>) {
		this.leftSeq = leftSeq;
		this.rightSeq = rightSeq;
		this.selector = selector;
	}
	*[Symbol.iterator]() {
		const iter = this.rightSeq[Symbol.iterator]();
		let result: IteratorResult<U>;
		for (const value of this.leftSeq) {
			if ((result = iter.next()).done)
				break;
			yield this.selector(value, result.value);
		}
	}
	forEach(iteratee: Predicate<R>) {
		const iter = this.rightSeq[Symbol.iterator]();
		let result: IteratorResult<U>;
		return iterateOver(this.leftSeq, value => {
			if ((result = iter.next()).done)
				return false;
			return iteratee(this.selector(value, result.value));
		});
	}
}

function arrayOf<T>(sequence: Sequence<T>)
{
	const values: T[] = [];
	iterateOver(sequence, (value) => {
		values.push(value);
		return true;
	});
	return values;
}

function iterateOver<T>(sequence: Sequence<T>, iteratee: Predicate<T>)
{
	if (sequence.forEach !== undefined) {
		// prefer forEach if it exists (better performance!)
		return sequence.forEach(iteratee);
	}
	else {
		// no forEach, fall back on [Symbol.iterator]
		for (const value of sequence) {
			if (!iteratee(value))
				return false;
		}
		return true;
	}
}

function sequenceOf<T>(source: Queryable<T>)
{
	return 'length' in source
		? new ArrayLikeSeq(source)
		: source;
}
