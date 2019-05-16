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

type Queryable<T> = T[] | ArrayLike<T> | Iterable<T> | Query<T>;

type Aggregator<T, R> = (accumulator: R, value: T) => R;
type Iteratee<T> = (value: T) => void;
type JoinPredicate<T, U> = (lValue: T, rValue: U) => boolean;
type Predicate<T> = (value: T) => boolean;
type Selector<T, R> = (value: T) => R;
type ZipSelector<T, U, R> = (lValue: T, rValue: U) => R;

interface Sequence<T> extends Iterable<T>
{
	forEach?(iteratee: Predicate<T>): boolean;
}

export default
function from<T>(source: Queryable<T>)
{
	return new Query(sequenceOf(source));
}

class Query<T> implements Iterable<T>
{
	readonly [Symbol.toStringTag] = "Query";

	private sequence: Sequence<T>;

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

	any(predicate: Predicate<T>)
	{
		let foundIt = false;
		iterateOver(this.sequence, value => {
			foundIt = predicate(value);
			return !foundIt;
		});
		return foundIt;
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

	forEach(iteratee: Iteratee<T>)
	{
		iterateOver(this.sequence, it => {
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

	join<U, R>(joinSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(joinSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
	}

	orderBy<K>(keySelector: Selector<T, K>, direction: 'asc' | 'desc' = 'asc')
	{
		return new Query(new OrderBySeq(this.sequence, keySelector, direction === 'desc'));
	}

	plus(...values: T[])
	{
		return new Query(new ConcatSeq(this.sequence, [ values ]));
	}

	select<R>(selector: Selector<T, R>)
	{
		return new Query(new SelectSeq(this.sequence, selector));
	}

	selectMany<R>(selector: Selector<T, Queryable<R>>)
	{
		return new Query(new SelectManySeq(this.sequence, selector));
	}

	skip(count: number)
	{
		return new Query(new SkipSeq(this.sequence, count));
	}

	skipWhile(predicate: Predicate<T>)
	{
		return new Query(new SkipWhileSeq(this.sequence, predicate));
	}

	take(count: number)
	{
		return new Query(new TakeSeq(this.sequence, count));
	}

	takeWhile(predicate: Predicate<T>)
	{
		return new Query(new TakeWhileSeq(this.sequence, predicate));
	}

	toArray()
	{
		return this.aggregate((a, it) => (a.push(it), a), [] as T[])
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

class IterableSeq<T> implements Sequence<T>
{
	private source: Iterable<T>;

	constructor(source: Iterable<T>) {
		this.source = source;
	}
	[Symbol.iterator]() {
		return this.source[Symbol.iterator]();
	}
	forEach(iteratee: Predicate<T>) {
		for (const value of this.source) {
			if (!iteratee(value))
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
	private descending: boolean;
	private keySelector: Selector<T, K>;
	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>, keySelector: Selector<T, K>, descending: boolean) {
		this.sequence = sequence;
		this.descending = descending;
		this.keySelector = keySelector;
	}
	*[Symbol.iterator]() {
		type KeyValuePair = { key: K, value: T };
		const pairs: KeyValuePair[] = [];
		iterateOver(this.sequence, value => {
			const key = this.keySelector(value);
			pairs.push({ key, value });
			return true;
		});
		const comparator = this.descending
			? (b: KeyValuePair, a: KeyValuePair) => a.key < b.key ? -1 : a.key > b.key ? +1 : 0
			: (a: KeyValuePair, b: KeyValuePair) => a.key < b.key ? -1 : a.key > b.key ? +1 : 0;
		pairs.sort(comparator);
		for (let i = 0, len = pairs.length; i < len; ++i)
			yield pairs[i].value;
	}
	forEach(iteratee: Predicate<T>) {
		type KeyValuePair = { key: K, value: T };
		const pairs: KeyValuePair[] = [];
		iterateOver(this.sequence, value => {
			const key = this.keySelector(value);
			pairs.push({ key, value });
			return true;
		});
		const comparator = this.descending
			? (b: KeyValuePair, a: KeyValuePair) => a.key < b.key ? -1 : a.key > b.key ? +1 : 0
			: (a: KeyValuePair, b: KeyValuePair) => a.key < b.key ? -1 : a.key > b.key ? +1 : 0;
		pairs.sort(comparator);
		for (let i = 0, len = pairs.length; i < len; ++i) {
			if (!iteratee(pairs[i].value))
				return false;
		}
		return true;
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
		return iterateOver(this.sequence, it => {
			const results = sequenceOf(this.selector(it));
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
	return source instanceof Query ? source.sequence
		: 'length' in source ? new ArrayLikeSeq(source)
		: new IterableSeq(source);
}
