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
		iterateOver(this.sequence, it => {
			accumulator = aggregator(accumulator, it);
			return true;
		});
		return accumulator;
	}

	forEach(iteratee: Iteratee<T>)
	{
		iterateOver(this.sequence, it => {
			iteratee(it);
			return true;
		});
	}

	join<U, R>(innerSource: Queryable<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(innerSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
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

	take(count: number)
	{
		return new Query(new TakeSeq(this.sequence, count));
	}

	toArray()
	{
		return this.aggregate((a, it) => (a.push(it), a), [] as T[])
	}

	where(predicate: Predicate<T>)
	{
		return new Query(new WhereSeq(this.sequence, predicate));
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
		return iterateOver(this.sequence, (value: T) =>
			skipsLeft-- <= 0 ? iteratee(value) : true);
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
			yield value;
			if (--takesLeft <= 0)
				break;
		}
	}
	forEach(iteratee: Predicate<T>) {
		let takesLeft = this.count;
		return iterateOver(this.sequence, (value: T) =>
			takesLeft-- > 0 ? iteratee(value) : false);
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
		return iterateOver(this.sequence, it => {
			return this.predicate(it)
				? iteratee(it)
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
		return iterateOver(this.leftSeq, (value: T) => {
			if ((result = iter.next()).done)
				return false;
			return iteratee(this.selector(value, result.value));
		});
	}
}

function iterateOver<T>(sequence: Sequence<T>, iteratee: Predicate<T>)
{
	if (sequence.forEach !== undefined) {
		// prefer forEach if it exists (better performance)
		return sequence.forEach(iteratee);
	}
	else {
		// no forEach, fall back on iterator interface
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
